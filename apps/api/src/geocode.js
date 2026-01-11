// apps/api/src/geocode.js
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function geocodePlace(placeName) {
  if (!placeName || typeof placeName !== "string") return null;

  const q = placeName.trim();
  if (!q) return null;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", `${q}, Czechia`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "cz");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "statistika-hasici-stc/0.1 (contact: github.com/martypetrzel-lab)",
      "Accept-Language": "cs,en;q=0.8"
    }
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const top = data[0];
  const lat = Number(top.lat);
  const lon = Number(top.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  await sleep(1100);
  return { lat, lon, provider: "nominatim" };
}
