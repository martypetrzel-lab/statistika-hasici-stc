import "dotenv/config";
import express from "express";
import cors from "cors";

import { openDb } from "./db.js";
import { ingestFromRss } from "./ingest.js";

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || "../../data/incidents.db";
const RSS_URL = process.env.RSS_URL || "https://pkr.kr-stredocesky.cz/pkr/zasahy-jpo/feed.xml";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN
  })
);

const db = await openDb({ dbPath: DB_PATH });

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "hasici-stc-api",
    time: new Date().toISOString()
  });
});

// Ruční ingest (protože chceš manuální workflow)
app.post("/ingest", async (req, res) => {
  try {
    const url = (req.query.url || req.body?.url || RSS_URL).toString();
    const result = await ingestFromRss(db, url);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Výpis zásahů + filtry
app.get("/incidents", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const q = (req.query.q || "").toString().trim();
    const district = (req.query.district || "").toString().trim();
    const place = (req.query.place || "").toString().trim();
    const category = (req.query.category || "").toString().trim();

    const since = (req.query.since || "").toString().trim(); // ISO
    const until = (req.query.until || "").toString().trim(); // ISO

    const where = [];
    const params = [];

    if (district) { where.push("district = ?"); params.push(district); }
    if (place) { where.push("place = ?"); params.push(place); }
    if (category) { where.push("category = ?"); params.push(category); }

    if (since) { where.push("pub_date >= ?"); params.push(since); }
    if (until) { where.push("pub_date <= ?"); params.push(until); }

    if (q) {
      where.push("(title LIKE ? OR raw_description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await db.all(
      `SELECT incident_id, title, link, pub_date, category, subtype, place, district, status, end_time, road, km
       FROM incidents
       ${whereSql}
       ORDER BY pub_date DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalRow = await db.get(
      `SELECT COUNT(*) as cnt FROM incidents ${whereSql}`,
      params
    );

    res.json({
      ok: true,
      total: totalRow?.cnt ?? 0,
      limit,
      offset,
      items: rows
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Statistiky podle kategorií
app.get("/stats/categories", async (req, res) => {
  try {
    const since = (req.query.since || "").toString().trim();
    const until = (req.query.until || "").toString().trim();

    const where = [];
    const params = [];
    if (since) { where.push("pub_date >= ?"); params.push(since); }
    if (until) { where.push("pub_date <= ?"); params.push(until); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await db.all(
      `SELECT category, COUNT(*) as cnt
       FROM incidents
       ${whereSql}
       GROUP BY category
       ORDER BY cnt DESC`
      , params
    );

    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Statistiky top obcí
app.get("/stats/places", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 200);
    const since = (req.query.since || "").toString().trim();
    const until = (req.query.until || "").toString().trim();
    const district = (req.query.district || "").toString().trim();

    const where = [];
    const params = [];
    if (since) { where.push("pub_date >= ?"); params.push(since); }
    if (until) { where.push("pub_date <= ?"); params.push(until); }
    if (district) { where.push("district = ?"); params.push(district); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await db.all(
      `SELECT place, COUNT(*) as cnt
       FROM incidents
       ${whereSql}
       GROUP BY place
       ORDER BY cnt DESC
       LIMIT ?`,
      [...params, limit]
    );

    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// historie ingestů
app.get("/ingest/runs", async (_req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, source_url, started_at, finished_at, items_total, items_inserted, items_updated, items_skipped
       FROM ingest_runs
       ORDER BY id DESC
       LIMIT 50`
    );
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  console.log(`[api] RSS_URL = ${RSS_URL}`);
});
