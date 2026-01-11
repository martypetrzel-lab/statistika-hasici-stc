// apps/api/src/server.js
import express from "express";
import cors from "cors";
import { ingestOnce } from "./ingest.js";
import { stmts, getDbInfo, initDb } from "./db.js";

const app = express();
app.use(express.json());

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "hasici-stc-api", time: new Date().toISOString() });
});

app.get("/debug/db", (_req, res) => {
  res.json(getDbInfo());
});

app.post("/ingest", async (_req, res) => {
  try {
    const out = await ingestOnce();
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/incidents", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;

  const rows = await stmts.listIncidents({ from, to, limit, offset });
  res.json({ ok: true, limit, offset, count: rows.length, data: rows });
});

app.get("/stats/places", async (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;

  const rows = await stmts.statsPlaces({ from, to });
  const data = rows.map((r) => ({
    place: r.place,
    district: r.district,
    count: Number(r.count || 0),
    total_minutes: Number(r.total_minutes || 0),
    total_hours: Math.round((Number(r.total_minutes || 0) / 60) * 100) / 100,
    lat: r.lat == null ? null : Number(r.lat),
    lon: r.lon == null ? null : Number(r.lon),
  }));

  res.json({ ok: true, data });
});

const port = Number(process.env.PORT || 8787);

async function start() {
  await initDb();
  app.listen(port, () => console.log(`[api] listening on :${port}`));
}

start().catch((e) => {
  console.error("[api] failed to start:", e);
  process.exit(1);
});
