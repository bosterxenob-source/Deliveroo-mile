import { useState, useRef } from "react";

const MILES_PER_KM = 0.621371;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address + ", UK")}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  const data = await res.json();
  if (data.length > 0) {
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }
  return null;
}

function Pill({ color, children }) {
  return (
    <span style={{
      background: color + "18",
      border: `1px solid ${color}40`,
      color,
      fontSize: "9px",
      fontWeight: "800",
      padding: "3px 8px",
      borderRadius: "3px",
      letterSpacing: "1.5px",
    }}>{children}</span>
  );
}

export default function App() {
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [mediaType, setMediaType] = useState("image/jpeg");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setResult(null);
    setError(null);
    setStatus("");
    setMediaType(file.type || "image/jpeg");
    setImage(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (e) => setImageBase64(e.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!imageBase64) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      setStatus("🔍 Citesc screenshot-ul...");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              {
                type: "text",
                text: `This is a Deliveroo driver app screenshot. Extract delivery data.

Return ONLY valid JSON, no markdown, no explanation:
{
  "restaurantName": "name or null",
  "restaurantAddress": "full address with postcode or null",
  "customerAddress": "full address with postcode or null",
  "customerCoords": {"lat": 0.0, "lon": 0.0} or null,
  "restaurantCoords": {"lat": 0.0, "lon": 0.0} or null,
  "distanceKm": number or null,
  "pay": "£X.XX or null"
}

Rules:
- Extract exact addresses as shown including postcodes
- If GPS coordinates are visible (e.g. 53.817604, -1.540909), put them in customerCoords
- If no GPS coords visible, set customerCoords and restaurantCoords to null
- If explicit distance in km or miles is shown, put in distanceKm
- Otherwise set distanceKm to null`
              }
            ]
          }]
        })
      });

      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";

      let parsed;
      try {
        const clean = text.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        throw new Error("Nu am putut citi datele. Încearcă un screenshot mai clar.");
      }

      let restaurantCoords = parsed.restaurantCoords;
      let customerCoords = parsed.customerCoords;
      let method = "unknown";

      if (!restaurantCoords && parsed.restaurantAddress) {
        setStatus("📍 Geocodez restaurantul...");
        restaurantCoords = await geocode(parsed.restaurantAddress);
      }

      if (!customerCoords && parsed.customerAddress) {
        setStatus("📍 Geocodez adresa clientului...");
        customerCoords = await geocode(parsed.customerAddress);
      }

      let totalKm = parsed.distanceKm;
      let segments = [];

      if (!totalKm && restaurantCoords && customerCoords) {
        setStatus("📐 Calculez distanța...");
        const distKm = haversine(
          restaurantCoords.lat, restaurantCoords.lon,
          customerCoords.lat, customerCoords.lon
        );
        segments = [{ label: "Restaurant → Client", km: distKm }];
        totalKm = distKm;
        method = "geocoded";
      } else if (parsed.distanceKm) {
        method = "screen";
      }

      if (!totalKm) {
        throw new Error("Nu am găsit adrese sau distanțe în screenshot.");
      }

      const miles = totalKm * MILES_PER_KM;
      const newResult = {
        restaurantName: parsed.restaurantName,
        restaurantAddress: parsed.restaurantAddress,
        customerAddress: parsed.customerAddress,
        pay: parsed.pay,
        segments,
        totalKm,
        miles,
        method,
        timestamp: new Date().toLocaleTimeString("ro-RO"),
      };

      setResult(newResult);
      setHistory(prev => [newResult, ...prev].slice(0, 30));
      setStatus("");

    } catch (err) {
      setError(err.message || "Eroare la analiză.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  };

  const totalMiles = history.reduce((s, h) => s + h.miles, 0);
  const totalKmAll = history.reduce((s, h) => s + h.totalKm, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#06100f", fontFamily: "'DM Mono', 'Courier New', monospace", color: "#c8e8e4" }}>
      <div style={{ background: "linear-gradient(135deg, #00ccbb 0%, #009e90 100%)", padding: "16px 20px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "22px" }}>🛵</span>
          <div>
            <div style={{ fontWeight: "900", fontSize: "15px", color: "#002e2a" }}>DELIVEROO MILES</div>
            <div style={{ fontSize: "9px", color: "#004d46", fontWeight: "700", letterSpacing: "1.5px" }}>AUTO-GEOCODING · UK</div>
          </div>
          {history.length > 0 && (
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: "18px", fontWeight: "900", color: "#002e2a" }}>{totalMiles.toFixed(2)} mi</div>
              <div style={{ fontSize: "9px", color: "#004d46" }}>{history.length} comenzi</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: "440px", margin: "0 auto", padding: "18px 14px" }}>
        <div onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }} onDragOver={(e) => e.preventDefault()} onClick={() => !loading && fileRef.current.click()}
          style={{ border: image ? "1px solid #00ccbb33" : "2px dashed #0e2a26", borderRadius: "10px", padding: image ? "6px" : "32px 16px", textAlign: "center", cursor: loading ? "not-allowed" : "pointer", background: "#0b1e1b", marginBottom: "12px" }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          {image ? (
            <img src={image} alt="Screenshot" style={{ width: "100%", maxHeight: "240px", borderRadius: "6px", objectFit: "contain" }} />
          ) : (
            <>
              <div style={{ fontSize: "32px", marginBottom: "8px" }}>📱</div>
              <div style={{ color: "#2a6b62", fontSize: "13px" }}>Apasă sau trage screenshot-ul Deliveroo</div>
              <div style={{ color: "#143d38", fontSize: "11px", marginTop: "6px" }}>Funcționează cu adrese · coordonate GPS · km afișat</div>
            </>
          )}
        </div>

        {status && <div style={{ background: "#0b1e1b", border: "1px solid #00ccbb22", borderRadius: "6px", padding: "10px 14px", color: "#00ccbb", fontSize: "12px", marginBottom: "12px" }}>{status}</div>}

        {image && !loading && (
          <button onClick={analyze} style={{ width: "100%", background: "linear-gradient(135deg, #00ccbb, #009e90)", color: "#002e2a", border: "none", borderRadius: "8px", padding: "15px", fontSize: "13px", fontWeight: "900", fontFamily: "inherit", cursor: "pointer", letterSpacing: "2px", marginBottom: "18px" }}>
            ⚡ CALCULEAZĂ MILELE
          </button>
        )}

        {error && <div style={{ background: "#160808", border: "1px solid #ff333322", borderRadius: "8px", padding: "13px", color: "#ff6666", fontSize: "12px", marginBottom: "16px" }}>❌ {error}</div>}

        {result && (
          <div style={{ background: "#0b1e1b", border: "2px solid #00ccbb33", borderRadius: "10px", padding: "18px", marginBottom: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <Pill color="#00ccbb">{result.method === "geocoded" ? "GEOCODAT" : "DIN ECRAN"}</Pill>
              <span style={{ color: "#1a4a44", fontSize: "10px" }}>{result.timestamp}</span>
            </div>
            {result.restaurantName && <div style={{ fontSize: "12px", color: "#00ccbb", fontWeight: "700", marginBottom: "4px" }}>🏪 {result.restaurantName}</div>}
            {result.restaurantAddress && <div style={{ fontSize: "11px", color: "#2a6b62", marginBottom: "10px" }}>{result.restaurantAddress}</div>}
            {result.customerAddress && <div style={{ fontSize: "11px", color: "#2a6b62", marginBottom: "14px" }}>👤 {result.customerAddress}</div>}
            {result.segments?.map((seg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #0e2a26", fontSize: "11px" }}>
                <span style={{ color: "#3a8a80" }}>{seg.label}</span>
                <div>
                  <span style={{ color: "#6ab8b0" }}>{seg.km.toFixed(2)} km</span>
                  <span style={{ color: "#2a6b62", marginLeft: "8px" }}>{(seg.km * MILES_PER_KM).toFixed(2)} mi</span>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "16px" }}>
              <div>
                {result.pay && <div style={{ color: "#00ccbb88", fontSize: "11px", marginBottom: "4px" }}>💷 {result.pay}</div>}
                <div style={{ color: "#2a6b62", fontSize: "9px" }}>TOTAL</div>
                <div style={{ color: "#6ab8b0", fontSize: "16px", fontWeight: "700" }}>{result.totalKm.toFixed(2)} km</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#00ccbb", fontSize: "9px", fontWeight: "700", letterSpacing: "2px" }}>MILE</div>
                <div style={{ color: "#00ccbb", fontSize: "44px", fontWeight: "900", lineHeight: 1 }}>{result.miles.toFixed(2)}</div>
                <div style={{ color: "#00ccbb55", fontSize: "10px" }}>miles</div>
              </div>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ color: "#1a4a44", fontSize: "9px", letterSpacing: "2px" }}>ISTORIC · {history.length} comenzi</span>
              <span style={{ color: "#00ccbb", fontSize: "11px", fontWeight: "900" }}>{totalKmAll.toFixed(1)} km · {totalMiles.toFixed(2)} mi</span>
            </div>
            {history.map((h, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: i === 0 ? "#0f2520" : "#080f0e", borderRadius: "6px", marginBottom: "3px", fontSize: "11px", borderLeft: i === 0 ? "2px solid #00ccbb" : "2px solid #0e2a26" }}>
                <div>
                  <div style={{ color: "#3a8a80" }}>{h.timestamp}</div>
                  {h.restaurantName && <div style={{ color: "#1a4a44", fontSize: "10px" }}>{h.restaurantName}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#3a8a80" }}>{h.totalKm.toFixed(2)} km</div>
                  <div style={{ color: "#00ccbb", fontWeight: "900" }}>{h.miles.toFixed(2)} mi</div>
                </div>
              </div>
            ))}
            <button onClick={() => { setHistory([]); setResult(null); }} style={{ width: "100%", background: "transparent", border: "1px solid #0e2a26", borderRadius: "6px", padding: "9px", color: "#1a4a44", fontSize: "9px", fontFamily: "inherit", cursor: "pointer", marginTop: "8px", letterSpacing: "2px" }}>
              RESETEAZĂ ISTORICUL
            </button>
          </div>
        )}
      </div>
    </div>
  );
                                                      }
