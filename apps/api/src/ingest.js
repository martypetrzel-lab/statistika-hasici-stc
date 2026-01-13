import { parseRss } from "./rss.js";
import { upsertIncidents, countGeocodedAttempts } from "./db.js";

function looksLikeXml(s) {
  return typeof s === "string" && s.trimStart().startsWith("<");
}

export async function ingestXml({ xml }) {
  if (!looksLikeXml(xml)) throw new Error("Missing or invalid XML");

  const items = await parseRss(xml);

  const normalized = items.map((it) => ({
    id: it.id,
    title: it.title,
    link: it.link,
    pubDate: it.pubDate,
    place: it.place
  }));

  const before = await countGeocodedAttempts();
  const { upserted } = await upsertIncidents(normalized);
  const after = await countGeocodedAttempts();

  return {
    fetched: normalized.length,
    upserted,
    geocoded_attempts: Math.max(0, after - before)
  };
}

export async function ingestOnce({ feedUrl }) {
  if (!feedUrl) throw new Error("Missing feedUrl");

  const r = await fetch(feedUrl, {
    headers: {
      "user-agent":
        "statistika-hasici-stc/1.0 (+https://github.com/martypetrzel-lab/statistika-hasici-stc)",
      accept: "application/rss+xml, application/xml, text/xml, */*"
    }
  });

  if (!r.ok) throw new Error(`FEED fetch failed: Status code ${r.status}`);

  const xml = await r.text();
  return await ingestXml({ xml });
}
