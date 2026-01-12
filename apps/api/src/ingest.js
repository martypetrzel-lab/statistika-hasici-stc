import { parseRss } from "./rss.js";
import { upsertIncidents, countGeocodedAttempts } from "./db.js";

/**
 * Railway + Node fetch nebere HTTP feedy bez TLS.
 * Pokud je feed http://..., automaticky ho vezmeme přes HTTPS proxy.
 */
function normalizeFeedUrl(feedUrl) {
  if (feedUrl.startsWith("http://")) {
    return (
      "https://api.allorigins.win/raw?url=" +
      encodeURIComponent(feedUrl)
    );
  }
  return feedUrl;
}

export async function ingestOnce({ feedUrl }) {
  if (!feedUrl) throw new Error("Missing feedUrl");

  const finalFeedUrl = normalizeFeedUrl(feedUrl);

  const r = await fetch(finalFeedUrl, {
    headers: {
      "user-agent":
        "statistika-hasici-stc/1.0 (+https://github.com/martypetrzel-lab/statistika-hasici-stc)",
      accept: "application/rss+xml, application/xml, text/xml, */*"
    }
  });

  if (!r.ok) {
    throw new Error(
      `FEED fetch failed: ${r.status} (${finalFeedUrl})`
    );
  }

  const xml = await r.text();
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
