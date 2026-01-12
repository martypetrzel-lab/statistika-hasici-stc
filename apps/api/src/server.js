// apps/api/src/server.js
import express from "express";
import cors from "cors";

async function tryLoadDotenv() {
  try {
    const mod = await import("dotenv");
    if (mod?.default?.config) mod.default.config();
    else if (mod?.config) mod.config();
  } catch {
    // ignore
  }
}

if (process.env.NODE_ENV !== "production") {
  await tryLoadDotenv();
}

import { ingestOnce } from "./ingest.js";
import { openDb, ensureSchema, all } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FEED_URL =
  process.env.RSS_URL ||
  "https://pkr.kr-stredocesky.cz/pkr/zasahy-jpo/rss";

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/ingest", async (req, res) => {
  try {
    const result = await ingestOnce({ feedUrl: FEED_URL });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// rychlý test výpisu míst (top)
app.get("/places", async (req, res) => {
  try {
    const db = openDb();
    await ensureSchema(db);

    const rows = await all(
      db,
      `
      SELECT place, COUNT(*) as count
      FROM incidents
      WHERE place IS NOT NULL
      GROUP BY place
      ORDER BY count DESC
      LIMIT 200
    `
    );
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
  console.log(`[api] feed: ${FEED_URL}`);
});
