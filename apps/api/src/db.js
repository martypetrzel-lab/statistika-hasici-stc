import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

let state = {
  incidents: [],
  geocodeAttempts: 0,
};

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function load() {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), "utf-8");
    return;
  }
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  state = JSON.parse(raw);
  if (!state.incidents) state.incidents = [];
  if (typeof state.geocodeAttempts !== "number") state.geocodeAttempts = 0;
}

function save() {
  ensureDir(DATA_DIR);
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export async function initDb() {
  load();
}

export async function countGeocodedAttempts() {
  return state.geocodeAttempts || 0;
}

export async function upsertIncidents(items) {
  const byId = new Map(state.incidents.map((x) => [x.id, x]));
  let upserted = 0;

  for (const it of items) {
    if (!it?.id) continue;
    const existing = byId.get(it.id);

    if (!existing) {
      byId.set(it.id, it);
      upserted++;
    } else {
      // update fields (keep stable id)
      const merged = { ...existing, ...it, id: existing.id };
      byId.set(it.id, merged);
      upserted++;
    }
  }

  state.incidents = Array.from(byId.values()).sort((a, b) => {
    const ta = Date.parse(a.pubDate || "") || 0;
    const tb = Date.parse(b.pubDate || "") || 0;
    return tb - ta;
  });

  save();
  return { upserted };
}

export async function getPlaces() {
  const counts = new Map();
  for (const it of state.incidents) {
    const place = it.place;
    if (!place) continue;
    counts.set(place, (counts.get(place) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([place, count]) => ({ place, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getPlacesStats({ from, to }) {
  const fromTs = from ? Date.parse(from) : null;
  const toTs = to ? Date.parse(to) : null;

  const counts = new Map();

  for (const it of state.incidents) {
    const place = it.place;
    if (!place) continue;

    const ts = Date.parse(it.pubDate || "") || 0;

    if (fromTs && ts < fromTs) continue;
    if (toTs && ts > toTs) continue;

    counts.set(place, (counts.get(place) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([place, count]) => ({ place, count }))
    .sort((a, b) => b.count - a.count);
}
