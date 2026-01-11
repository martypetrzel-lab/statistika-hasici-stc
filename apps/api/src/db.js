import path from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDbPath(dbPath) {
  if (!dbPath) return path.join(__dirname, "../../..", "data", "incidents.db");
  if (path.isAbsolute(dbPath)) return dbPath;
  return path.resolve(__dirname, dbPath);
}

export async function openDb({ dbPath }) {
  const filename = resolveDbPath(dbPath);

  const db = await open({
    filename,
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      guid TEXT,
      pub_date TEXT NOT NULL,         -- ISO UTC
      category TEXT,
      subtype TEXT,
      place TEXT,
      district TEXT,
      status TEXT,
      end_time TEXT,                 -- ISO (lokální string z RSS), může být NULL
      road TEXT,
      km REAL,
      raw_description TEXT,
      ingested_at TEXT NOT NULL      -- ISO UTC
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_pub_date ON incidents(pub_date);
    CREATE INDEX IF NOT EXISTS idx_incidents_place ON incidents(place);
    CREATE INDEX IF NOT EXISTS idx_incidents_district ON incidents(district);
    CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);

    CREATE TABLE IF NOT EXISTS ingest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      items_total INTEGER NOT NULL,
      items_inserted INTEGER NOT NULL,
      items_updated INTEGER NOT NULL,
      items_skipped INTEGER NOT NULL,
      note TEXT
    );
  `);

  return db;
}
