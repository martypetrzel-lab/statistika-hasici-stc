import { parseRss } from "./rss.js";
import { upsertIncidents, countGeocodedAttempts } from "./db.js";

export async function ingestOnce({ feedUrl }) {
  if (!feedUrl) throw new Error("Missing feedUrl");

  // Node 18+ has global fetch
  const r = await fetch(feedUrl, {
    headers: {
      "user-agent":
        "statistika-hasici-stc/1.0 (+https://github.com/martypetrzel-lab/statistika-hasici-stc)",
      accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });

  if (!r.ok) {
    // this is where your "Status code 404" was coming from
    throw new Error(`FEED fetch failed: Status code ${r.status}`);
  }

  const xml = await r.text();
  const items = await parseRss(xml);

  const normalized = items.map((it) => ({
    id: it.id,
    title: it.title,
    link: it.link,
    pubDate: it.pubDate,
    place: it.place,
  }));

  const beforeGeocodeAttempts = await countGeocodedAttempts();
  const { upserted } = await upsertIncidents(normalized);
  const afterGeocodeAttempts = await countGeocodedAttempts();

  return {
    fetched: normalized.length,
    upserted,
    geocoded_attempts: Math.max(0, afterGeocodeAttempts - beforeGeocodeAttempts),
  };
}
