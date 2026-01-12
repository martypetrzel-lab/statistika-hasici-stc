// apps/api/src/db.js
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";

sqlite3.verbose();

function resolveDbPath() {
  const fromEnv =
    process.env.DB_PATH ||
    process.env.SQLITE_PATH ||
    process.env.DATABASE_PATH;

  if (fromEnv) return fromEnv;

  return path.join(process.cwd(), "data", "hasici.sqlite");
}

export function openDb() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  return new sqlite3.Database(dbPath);
}

export function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

export function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

export async function ensureSchema(db) {
  await run(
    db,
    `
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
  `
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_incidents_ts ON incidents(ts);`);
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_incidents_place ON incidents(place);`
  );
}
