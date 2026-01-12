import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { ingestOnce } from "./ingest.js";
import { initDb, getPlaces, getPlacesStats } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8787);
const FEED_URL =
  process.env.FEED_URL || "https://pkr.kr-stredocesky.cz/pkr/zasahy-jpo/rss";

// --- boot DB
await initDb();

// --- health
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// --- places (simple list)
app.get("/places", async (req, res) => {
  try {
    const rows = await getPlaces();
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- stats/places
// supports optional query: ?from=2026-01-01&to=2026-01-31
app.get("/stats/places", async (req, res) => {
  try {
    const from = req.query?.from ? String(req.query.from) : null;
    const to = req.query?.to ? String(req.query.to) : null;

    const data = await getPlacesStats({ from, to });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- ingest
// POST /ingest  (production way)
// GET  /ingest  (dev/testing convenience: open in browser)
async function runIngest(req, res) {
  try {
    const feedUrl =
      (req.body && req.body.feedUrl) ||
      (req.query && req.query.feedUrl) ||
      FEED_URL;

    const result = await ingestOnce({ feedUrl });
    res.json({ ok: true, ...result });
  } catch (e) {
    // Important: make it obvious if FEED failed (404 etc.)
    res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      hint:
        "Pokud vidíš 'Status code 404', je to téměř jistě 404 z RSS feedu (ne z /ingest routy). Zkus otevřít FEED_URL v prohlížeči.",
      feed: FEED_URL,
    });
  }
}

app.post("/ingest", runIngest);
app.get("/ingest", runIngest);

// --- 404 fallback
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
  console.log(`[api] feed: ${FEED_URL}`);
});
