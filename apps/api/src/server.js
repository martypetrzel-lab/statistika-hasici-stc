import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { ingestOnce, ingestXml } from "./ingest.js";
import { initDb, getPlaces, getPlacesStats, getIncidents } from "./db.js";

dotenv.config();

const app = express();
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*"
  })
);

// nejdřív JSON obecně
app.use(express.json({ limit: "5mb" }));

// ✅ ale pro ingest dovolíme raw text (XML) – jen na této cestě
app.use(
  "/api/ingest",
  express.text({
    type: [
      "application/xml",
      "text/xml",
      "application/rss+xml",
      "text/plain"
    ],
    limit: "5mb"
  })
);

const PORT = Number(process.env.PORT || 8787);
const FEED_URL =
  process.env.FEED_URL || "https://pkr.kr-stredocesky.cz/pkr/zasahy-jpo/feed.xml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Boot DB
await initDb();

// Static frontend
app.use("/", express.static(path.join(__dirname, "public")));

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// API: incidents
app.get("/api/incidents", async (req, res) => {
  try {
    const limit = req.query?.limit ? Number(req.query.limit) : 200;
    const rows = await getIncidents({ limit });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// API: places list
app.get("/api/places", async (req, res) => {
  try {
    const limit = req.query?.limit ? Number(req.query.limit) : 200;
    const rows = await getPlaces({ limit });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// API: stats/places
app.get("/api/stats/places", async (req, res) => {
  try {
    const from = req.query?.from ? String(req.query.from) : null;
    const to = req.query?.to ? String(req.query.to) : null;
    const limit = req.query?.limit ? Number(req.query.limit) : 30;

    const data = await getPlacesStats({ from, to, limit });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Ingest endpoint (umí: 1) poslané XML 2) JSON {xml} 3) fetch z feedUrl
async function runIngest(req, res) {
  try {
    // 1) když přišlo raw XML (Content-Type: application/xml)
    if (typeof req.body === "string" && req.body.trimStart().startsWith("<")) {
      const result = await ingestXml({ xml: req.body });
      return res.json({ ok: true, mode: "xml", ...result });
    }

    // 2) když přišlo JSON { xml: "..." }
    const bodyXml = req.body && typeof req.body === "object" ? req.body.xml : null;
    if (typeof bodyXml === "string" && bodyXml.trimStart().startsWith("<")) {
      const result = await ingestXml({ xml: bodyXml });
      return res.json({ ok: true, mode: "xml", ...result });
    }

    // 3) fallback: stáhnout feedUrl
    const feedUrl =
      (req.body && req.body.feedUrl) ||
      (req.query && req.query.feedUrl) ||
      FEED_URL;

    const result = await ingestOnce({ feedUrl });
    return res.json({ ok: true, mode: "fetch", feedUrl, ...result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      feed: FEED_URL
    });
  }
}

app.post("/api/ingest", runIngest);
app.get("/api/ingest", runIngest);

// 404 fallback (API)
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
  console.log(`[api] feed: ${FEED_URL}`);
});

// AUTO INGEST (doporučuji na Railway vypnout env AUTO_INGEST=0)
const AUTO_INGEST = String(process.env.AUTO_INGEST || "1") !== "0";
const EVERY_SECONDS = Number(process.env.INGEST_EVERY_SECONDS || 300);

if (AUTO_INGEST) {
  const tick = async () => {
    try {
      const r = await ingestOnce({ feedUrl: FEED_URL });
      console.log(`[ingest] ok fetched=${r.fetched} upserted=${r.upserted}`);
    } catch (e) {
      console.error(`[ingest] fail`, e?.message || e);
    }
  };

  tick();
  setInterval(tick, Math.max(30, EVERY_SECONDS) * 1000);
}
