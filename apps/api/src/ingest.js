// apps/api/src/ingest.js
import { parseRss } from "./rss.js";
import { openDb, ensureSchema, run } from "./db.js";

function extractPlaceDistrictCounty(item) {
  // description má formát: "stav: ...<br>Město<br>okres XYZ"
  const desc = (item.description || "").replaceAll("&lt;br&gt;", "\n");
  const lines = desc
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // typicky:
  // 0: "stav: ..."
  // 1: "Město"
  // 2: "okres Praha Východ" (ne vždy)
  const place = lines[1] || null;

  let district = null;
  let county = null;

  const okresLine = lines.find((l) => l.toLowerCase().startsWith("okres "));
  if (okresLine) district = okresLine.slice(6).trim();

  // county zatím neumíme z feedu spolehlivě -> necháme null
  return { place, district, county, raw_place: place };
}

function toUnixTs(pubDate) {
  const d = pubDate ? new Date(pubDate) : null;
  const t = d && !Number.isNaN(d.getTime()) ? Math.floor(d.getTime() / 1000) : null;
  return t;
}

export async function ingestOnce({ feedUrl }) {
  const items = await parseRss(feedUrl);

  const db = openDb();
  await ensureSchema(db);

  let inserted = 0;

  for (const item of items) {
    const id = item.guid || item.id || item.link;
    if (!id) continue;

    const ts = toUnixTs(item.pubDate);
    const { place, district, county, raw_place } = extractPlaceDistrictCounty(item);

    // lat/lon zatím null (geokódování později)
    const res = await run(
      db,
      `
      INSERT OR IGNORE INTO incidents
      (id, ts, title, link, place, district, county, lat, lon, raw_place)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        id,
        ts,
        item.title || null,
        item.link || null,
        place,
        district,
        county,
        null,
        null,
        raw_place,
      ]
    );

    if (res.changes > 0) inserted += 1;
  }

  return { inserted, total: items.length };
}
