// apps/api/src/db.js
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// dotenv jen lokálně (když existuje). Na Railway se ENV nastavují v UI.
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

function resolveDbPath() {
  // Preferuj explicitní env
  // Doporučení: na Railway nastav DB_PATH na cestu do volume (např. /data/hasici.sqlite)
  const fromEnv =
    process.env.DB_PATH ||
    process.env.SQLITE_PATH ||
    process.env.DATABASE_PATH;

  if (fromEnv) return fromEnv;

  // Lokální fallback
  return path.join(process.cwd(), "data", "hasici.sqlite");
}

export function openDb() {
  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);

  // vytvoř složku pro DB, pokud neexistuje
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      ts INTEGER,
      title TEXT,
      link TEXT,
      place TEXT,
      district TEXT,
      county TEXT,
      lat REAL,
      lon REAL,
      raw_place TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_ts ON incidents(ts);
    CREATE INDEX IF NOT EXISTS idx_incidents_place ON incidents(place);
  `);
}
