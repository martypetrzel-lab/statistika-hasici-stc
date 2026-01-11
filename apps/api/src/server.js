import "dotenv/config";
import express from "express";
import cors from "cors";

import { openDb } from "./db.js";
import { ingestFromRss } from "./ingest.js";

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || "../../../data/incidents.db";
const RSS_URL = process.env.RSS_URL || "https://pkr.kr-stredocesky.cz/pkr/zasahy-jpo/feed.xml";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const APP_TZ = "Europe/Prague";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN
  })
);

const db = await openDb({ dbPath: DB_PATH });

/**
 * Vrátí offset (ms) pro dané UTC Date při zobrazení v časové zóně `timeZone`.
 * (funguje i pro DST)
 */
function getTimeZoneOffsetMs(dateUtc, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = dtf.formatToParts(dateUtc);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  // rozdíl mezi tím, co by bylo UTC podle zobrazených částí, a skutečným UTC timestampem
  return asUtc - dateUtc.getTime();
}

/**
 * Převede lokální ISO bez TZ (např. "2026-10-01T21:32:00") v Europe/Prague na UTC ISO.
 */
function pragueLocalIsoToUtcIso(localIso) {
  if (!localIso) return null;

  const m = String(localIso).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? "0");

  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;

  // 1) vezmeme "stejný čas" jako UTC (jen jako výchozí bod)
  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // 2) zjistíme offset Europe/Prague v tomhle okamžiku
  const offsetMs = getTimeZoneOffsetMs(asUtc, APP_TZ);

  // 3) lokální čas = UTC + offset -> tedy UTC = lokální - offset
  const utc = new Date(asUtc.getTime() - offsetMs);

  return utc.toISOString();
}

/**
 * Spočítá délku zásahu v minutách:
 * pub_date je ISO UTC (z RSS)
 * end_time je ISO bez TZ (z parsování "ukončení:"), interpretujeme jako Europe/Prague
 */
function computeDurationMin(pubDateIsoUtc, endTimeLocalIso) {
  if (!pubDateIsoUtc || !endTimeLocalIso) return null;

  const startMs = Date.parse(pubDateIsoUtc);
  if (!Number.isFinite(startMs)) return null;

  const endUtcIso = pragueLocalIsoToUtcIso(endTimeLocalIso);
  if (!endUtcIso) return null;

  const endMs = Date.parse(endUtcIso);
  if (!Number.isFinite(endMs)) return null;

  const diffMin = Math.round((endMs - startMs) / 60000);
  if (!Number.isFinite(diffMin)) return null;

  // ignorujeme nesmysly (negativní)
  if (diffMin < 0) return null;

  return diffMin;
}

function minutesToHours(min) {
  if (!Number.isFinite(min)) return null;
  return Math.round((min / 60) * 100) / 100; // 2 desetinná místa
}

async function loadIncidentsForDurationAggregation(filters) {
  const {
    since = "",
    until = "",
    district = "",
    place = "",
    category = ""
  } = filters || {};

  const where = ["end_time IS NOT NULL", "end_time != ''"];
  const params = [];

  if (district) { where.push("district = ?"); params.push(district); }
  if (place) { where.push("place = ?"); params.push(place); }
  if (category) { where.push("category = ?"); params.push(category); }

  if (since) { where.push("pub_date >= ?"); params.push(since); }
  if (until) { where.push("pub_date <= ?"); params.push(until); }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return db.all(
    `SELECT pub_date, end_time, place, district, category
     FROM incidents
     ${whereSql}
     ORDER BY pub_date DESC`,
    params
  );
}

function aggregateDurations(rows, keyFn) {
  const acc = new Map();

  for (const r of rows) {
    const durMin = computeDurationMin(r.pub_date, r.end_time);
    if (durMin == null) continue;

    const key = keyFn(r) || "(neznámé)";
    const cur = acc.get(key) || 0;
    acc.set(key, cur + durMin);
  }

  const items = [...acc.entries()]
    .map(([key, totalMin]) => ({
      key,
      total_minutes: totalMin,
      total_hours: minutesToHours(totalMin)
    }))
    .sort((a, b) => b.total_minutes - a.total_minutes);

  return items;
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "hasici-stc-api",
    time: new Date().toISOString()
  });
});

// Ruční ingest
app.post("/ingest", async (req, res) => {
  try {
    const url = (req.query.url || req.body?.url || RSS_URL).toString();
    const result = await ingestFromRss(db, url);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Výpis zásahů + filtry (nově i duration_min)
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

    const items = rows.map((r) => ({
      ...r,
      duration_min: computeDurationMin(r.pub_date, r.end_time)
    }));

    res.json({
      ok: true,
      total: totalRow?.cnt ?? 0,
      limit,
      offset,
      items
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Statistiky podle kategorií (počty)
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
       ORDER BY cnt DESC`,
      params
    );

    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Statistiky top obcí (počty)
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

// ===== NOVÉ: duration statistiky (součet minut/hodin) =====

// Top obce podle součtu času v zásahu
app.get("/stats/duration/places", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 200);
    const since = (req.query.since || "").toString().trim();
    const until = (req.query.until || "").toString().trim();
    const district = (req.query.district || "").toString().trim();
    const category = (req.query.category || "").toString().trim();

    const rows = await loadIncidentsForDurationAggregation({ since, until, district, category });
    const items = aggregateDurations(rows, (r) => r.place).slice(0, limit).map((x) => ({
      place: x.key,
      total_minutes: x.total_minutes,
      total_hours: x.total_hours
    }));

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Okresy podle součtu času v zásahu
app.get("/stats/duration/districts", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const since = (req.query.since || "").toString().trim();
    const until = (req.query.until || "").toString().trim();
    const category = (req.query.category || "").toString().trim();

    const rows = await loadIncidentsForDurationAggregation({ since, until, category });
    const items = aggregateDurations(rows, (r) => r.district).slice(0, limit).map((x) => ({
      district: x.key,
      total_minutes: x.total_minutes,
      total_hours: x.total_hours
    }));

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Kategorie podle součtu času v zásahu
app.get("/stats/duration/categories", async (req, res) => {
  try {
    const since = (req.query.since || "").toString().trim();
    const until = (req.query.until || "").toString().trim();
    const district = (req.query.district || "").toString().trim();

    const rows = await loadIncidentsForDurationAggregation({ since, until, district });
    const items = aggregateDurations(rows, (r) => r.category).map((x) => ({
      category: x.key,
      total_minutes: x.total_minutes,
      total_hours: x.total_hours
    }));

    res.json({ ok: true, items });
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
