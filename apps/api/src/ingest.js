import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

import { parseRss } from "./rss.js";
import { upsertIncidents, countGeocodedAttempts } from "./db.js";

function getTimeoutMs() {
  const v = Number(process.env.INGEST_FETCH_TIMEOUT_MS || 120000);
  return Number.isFinite(v) && v > 0 ? v : 120000;
}

function isCfWorkerFeed(feedUrl) {
  try {
    const u = new URL(feedUrl);
    return (
      u.hostname.endsWith("statistikahasici.org") ||
      u.hostname.endsWith("workers.dev")
    );
  } catch {
    return false;
  }
}

function buildCandidates(feedUrl) {
  // ✅ CF feed: preferuj native (umíme family:4), fetch až jako fallback
  if (isCfWorkerFeed(feedUrl)) {
    return [
      { url: feedUrl, mode: "native" },
      { url: feedUrl, mode: "fetch" }
    ];
  }

  return [
    { url: feedUrl, mode: "native" },
    {
      url: "https://api.allorigins.win/raw?url=" + encodeURIComponent(feedUrl),
      mode: "fetch"
    },
    { url: "https://r.jina.ai/" + feedUrl, mode: "fetch" }
  ];
}

function shouldUseInsecureTls(url) {
  try {
    const u = new URL(url);
    return u.hostname === "pkr.kr-stredocesky.cz";
  } catch {
    return false;
  }
}

function formatErr(e) {
  if (!e) return "unknown error";
  if (e instanceof AggregateError && Array.isArray(e.errors)) {
    const parts = e.errors.map((x) => {
      const code = x?.code ? `${x.code}` : "";
      const msg = x?.message ? x.message : String(x);
      return code ? `${code}: ${msg}` : msg;
    });
    return `AggregateError(${parts.join(" | ")})`;
  }
  const code = e.code ? `${e.code}: ` : "";
  return code + (e.message || String(e));
}

function sanitizeXml(text) {
  if (typeof text !== "string") return text;
  let s = text.replace(/^\uFEFF/, "");
  const i = s.indexOf("<");
  if (i > 0) s = s.slice(i);
  return s;
}

function looksLikeXml(s) {
  if (typeof s !== "string") return false;
  return s.trimStart().startsWith("<");
}

async function fetchTextNative(url, { timeoutMs }) {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const lib = isHttps ? https : http;

  const insecure = isHttps && shouldUseInsecureTls(url);

  // ✅ vynutit IPv4 pro PKR + pro naši CF doménu (Railway/IPv6 zlobí)
  const forceIPv4 =
    u.hostname === "pkr.kr-stredocesky.cz" || u.hostname.endsWith("statistikahasici.org");

  const options = {
    method: "GET",
    headers: {
      "user-agent":
        "statistika-hasici-stc/1.0 (+https://github.com/martypetrzel-lab/statistika-hasici-stc)",
      accept: "application/rss+xml, application/xml, text/xml, */*"
    },
    ...(insecure ? { rejectUnauthorized: false } : {}),
    ...(forceIPv4 ? { family: 4 } : {})
  };

  return await new Promise((resolve, reject) => {
    const req = lib.request(u, options, (res) => {
      // redirecty
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const next = new URL(res.headers.location, u).toString();
        res.resume();
        fetchTextNative(next, { timeoutMs }).then(resolve).catch(reject);
        return;
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        const status = res.statusCode || 0;
        res.resume();
        reject(new Error(`Status code ${status}`));
        return;
      }

      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Timeout"));
    });

    req.end();
  });
}

async function fetchTextViaFetch(url, { timeoutMs }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "statistika-hasici-stc/1.0 (+https://github.com/martypetrzel-lab/statistika-hasici-stc)",
        accept: "application/rss+xml, application/xml, text/xml, */*"
      },
      redirect: "follow"
    });

    if (!r.ok) throw new Error(`Status code ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

export async function ingestOnce({ feedUrl }) {
  if (!feedUrl) throw new Error("Missing feedUrl");

  const timeoutMs = getTimeoutMs();
  const candidates = buildCandidates(feedUrl);

  const errors = [];
  let xml = null;
  let usedUrl = null;

  for (const c of candidates) {
    const { url, mode } = c;
    try {
      console.log(`[ingest] fetch try ${url} (${mode}) (timeout ${timeoutMs}ms)`);

      if (mode === "native") {
        xml = await fetchTextNative(url, { timeoutMs });
      } else {
        xml = await fetchTextViaFetch(url, { timeoutMs });
      }

      xml = sanitizeXml(xml);

      if (!looksLikeXml(xml)) {
        throw new Error("Upstream did not return XML (no '<' found at start)");
      }

      usedUrl = url;
      console.log(`[ingest] fetch ok ${url}`);
      break;
    } catch (e) {
      const msg = formatErr(e);
      errors.push({ url, err: msg });
      console.log(`[ingest] fetch fail ${url}: ${msg}`);
    }
  }

  if (!xml) {
    const summary = errors.map((x) => `${x.url} => ${x.err}`).join(" | ");
    throw new Error(`FEED fetch failed: ${summary}`);
  }

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
