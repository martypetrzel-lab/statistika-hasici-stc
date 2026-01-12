// apps/api/src/server.js
import http from "http";
import express from "express";

import { openDb, ensureSchema } from "./db.js";
import { runIngest } from "./ingest.js";

// dotenv je jen pro lokální běh (když existuje). Na Railway se proměnné nastavují v UI.
// Když dotenv není nainstalované (např. production install bez devDependencies), nic se nestane.
async function tryLoadDotenv() {
  try {
    const mod = await import("dotenv");
    if (mod?.default?.config) mod.default.config();
    else if (mod?.config) mod.config();
  } catch {
    // ignore
  }
}

// spusť dotenv jen mimo production
if (process.env.NODE_ENV !== "production") {
  await tryLoadDotenv();
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8787);

// DB init (SQLite soubor musí být na volume / persistent path)
const db = openDb();
ensureSchema(db);

// health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "hasici-stc-api",
    time: new Date().toISOString(),
  });
});

// ingest endpoint (ruční spuštění)
app.get("/ingest", async (req, res) => {
  try {
    const result = await runIngest(db);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// stats: places (s volitelným filtrem času)
app.get("/stats/places", (req, res) => {
  try {
    const from = req.query.from ? Number(req.query.from) : null;
    const to = req.query.to ? Number(req.query.to) : null;

    const where = [];
    const params = {};
    if (from) {
      where.push("ts >= @from");
      params.from = from;
    }
    if (to) {
      where.push("ts <= @to");
      params.to = to;
    }

    const sql = `
      SELECT
        place as name,
        district,
        county,
        COUNT(*) as count
      FROM incidents
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY place, district, county
      ORDER BY count DESC
      LIMIT 500
    `;

    const rows = db.prepare(sql).all(params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// start
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
