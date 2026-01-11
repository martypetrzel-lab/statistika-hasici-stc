// apps/api/src/server.js
import "dotenv/config";
import express from "express";

import { ingestOnce } from "./ingest.js";
import { stmts } from "./db.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "hasici-stc-api",
    time: new Date().toISOString(),
  });
});

/**
 * Ingest RSS -> SQLite
 * - GET  /ingest  (pohodlné pro test v prohlížeči)
 * - POST /ingest  (stejné, vhodné pro cron / job)
 */
async function handleIngest(_req, res) {
  try {
    const result = await ingestOnce();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

app.get("/ingest", handleIngest);
app.post("/ingest", handleIngest);

// --- STATS ---

app.get("/stats/places", async (_req, res) => {
  try {
    const rows = await stmts.statsPlaces();
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("/stats/categories", async (_req, res) => {
  try {
    const rows = await stmts.statsCategories();
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("/stats/districts", async (_req, res) => {
  try {
    const rows = await stmts.statsDistricts();
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
  if (!process.env.RSS_URL) {
    console.log("[api] WARNING: RSS_URL is not set (ingest will fail until you set it).");
  }
});
