import { parseRss } from "./rss.js";
import { upsertIncidents, countGeocodedAttempts } from "./db.js";

function buildCandidates(feedUrl) {
  // 1) origin
  const candidates = [feedUrl];

  // 2) HTTPS proxy (funguje pro http i https)
  candidates.push(
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(feedUrl)
  );

  // 3) jina.ai proxy (funguje pro http i https)
  //    (jina.ai očekává URL za lomítkem)
  candidates.push("https://r.jina.ai/" + feedUrl);

  return candidates;
}

async function fetchWithTimeout(url, { timeoutMs = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: ctrl.signal, headers });
  } finally {
    clearTimeout(t);
  }
}

export async function ingestOnce({ feedUrl }) {
  if (!feedUrl) throw new Error("Missing feedUrl");

  const headers = {
    "user-agent":
      "statistika-hasici-stc/1.0 (+https://github.com/martypetrzel-lab/statistika-hasici-stc)",
    accept: "application/rss+xml, application/xml, text/xml, */*"
  };

  const candidates = buildCandidates(feedUrl);

  let lastErr = null;
  let response = null;
  let usedUrl = null;

  for (const url of candidates) {
    try {
      const r = await fetchWithTimeout(url, { timeoutMs: 15000, headers });

      if (!r.ok) {
        lastErr = new Error(`FEED fetch failed: Status code ${r.status} (${url})`);
        continue;
      }

      response = r;
      usedUrl = url;
      break;
    } catch (e) {
      lastErr = new Error(`FEED fetch failed: ${e?.message || String(e)} (${url})`);
      continue;
    }
  }

  if (!response) throw lastErr || new Error("FEED fetch failed: unknown error");

  const xml = await response.text();
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
    geocoded_attempts: Math.max(0, after - before),
    source: usedUrl
  };
}
