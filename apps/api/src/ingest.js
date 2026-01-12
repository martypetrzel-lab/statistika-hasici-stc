import { parseRss } from "./rss.js";
import { upsertIncidents, countGeocodedAttempts } from "./db.js";

function buildCandidates(feedUrl) {
  // Dáme proxy první (Railway často narazí na TLS/latenci u originu)
  return [
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(feedUrl),
    "https://r.jina.ai/" + feedUrl,
    feedUrl
  ];
}

function getTimeoutMs() {
  // lze přenastavit v Railway Variables: INGEST_FETCH_TIMEOUT_MS=60000
  const v = Number(process.env.INGEST_FETCH_TIMEOUT_MS || 45000);
  return Number.isFinite(v) && v > 0 ? v : 45000;
}

async function fetchWithTimeout(url, { timeoutMs, headers }) {
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

  const timeoutMs = getTimeoutMs();
  const candidates = buildCandidates(feedUrl);

  let response = null;
  let usedUrl = null;
  const errors = [];

  for (const url of candidates) {
    try {
      console.log(`[ingest] fetch try ${url} (timeout ${timeoutMs}ms)`);
      const r = await fetchWithTimeout(url, { timeoutMs, headers });

      if (!r.ok) {
        const err = `Status code ${r.status}`;
        errors.push({ url, err });
        console.log(`[ingest] fetch bad ${url}: ${err}`);
        continue;
      }

      response = r;
      usedUrl = url;
      console.log(`[ingest] fetch ok ${url}`);
      break;
    } catch (e) {
      const msg = e?.message || String(e);
      errors.push({ url, err: msg });
      console.log(`[ingest] fetch fail ${url}: ${msg}`);
      continue;
    }
  }

  if (!response) {
    // vypíšeme souhrn – výrazně pomůže debug
    const summary = errors.map((x) => `${x.url} => ${x.err}`).join(" | ");
    throw new Error(`FEED fetch failed: ${summary}`);
  }

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
