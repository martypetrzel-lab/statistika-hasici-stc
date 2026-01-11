// apps/api/src/db.js
import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

sqlite3.verbose();

const dbPath =
  process.env.DB_PATH ||
  path.join(process.cwd(), "..", "..", "..", "data", "incidents.db");

// ensure dir
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// open db
export const db = new sqlite3.Database(dbPath);

// helpers (promises)
export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export async function initDb() {
  await run(`PRAGMA journal_mode = WAL;`);

  await run(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guid TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      pub_date TEXT NOT NULL,
      category TEXT,
      subtype TEXT,
      place TEXT,
      district TEXT,
      status TEXT,
      ended_at TEXT,
      duration_minutes INTEGER,
      raw_description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_incidents_pub_date ON incidents(pub_date);`);
  await run(`CREATE INDEX IF NOT EXISTS idx_incidents_place ON incidents(place);`);

  await run(`
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place TEXT NOT NULL,
      district TEXT,
      lat REAL,
      lon REAL,
      provider TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(place, district)
    );
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_places_latlon ON places(lat, lon);`);
}

export function getDbInfo() {
  return { dbPath };
}

// "statements" as functions (since sqlite3 doesn't have sync prepared stmt usage like better-sqlite3)
export const stmts = {
  async upsertIncident(row) {
    // SQLite UPSERT by guid
    const sql = `
      INSERT INTO incidents (
        guid, title, link, pub_date, category, subtype,
        place, district, status, ended_at, duration_minutes, raw_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guid) DO UPDATE SET
        title=excluded.title,
        link=excluded.link,
        pub_date=excluded.pub_date,
        category=excluded.category,
        subtype=excluded.subtype,
        place=excluded.place,
        district=excluded.district,
        status=excluded.status,
        ended_at=excluded.ended_at,
        duration_minutes=excluded.duration_minutes,
        raw_description=excluded.raw_description
    `;
    const params = [
      row.guid,
      row.title,
      row.link,
      row.pub_date,
      row.category,
      row.subtype,
      row.place,
      row.district,
      row.status,
      row.ended_at,
      row.duration_minutes,
      row.raw_description,
    ];
    return run(sql, params);
  },

  async getPlace({ place, district }) {
    const sql = `
      SELECT * FROM places
      WHERE place = ?
        AND IFNULL(district,'') = IFNULL(?,'')
      LIMIT 1
    `;
    return get(sql, [place, district ?? null]);
  },

  async upsertPlaceCoords({ place, district, lat, lon, provider }) {
    const sql = `
      INSERT INTO places (place, district, lat, lon, provider, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(place, district) DO UPDATE SET
        lat=excluded.lat,
        lon=excluded.lon,
        provider=excluded.provider,
        updated_at=datetime('now')
    `;
    return run(sql, [place, district ?? null, lat, lon, provider ?? null]);
  },

  async listIncidents({ from, to, limit, offset }) {
    const sql = `
      SELECT * FROM incidents
      WHERE 1=1
        AND (? IS NULL OR pub_date >= ?)
        AND (? IS NULL OR pub_date <= ?)
      ORDER BY pub_date DESC
      LIMIT ? OFFSET ?
    `;
    return all(sql, [from, from, to, to, limit, offset]);
  },

  async statsPlaces({ from, to }) {
    const sql = `
      SELECT
        i.place as place,
        i.district as district,
        COUNT(*) as count,
        SUM(COALESCE(i.duration_minutes, 0)) as total_minutes,
        p.lat as lat,
        p.lon as lon
      FROM incidents i
      LEFT JOIN places p
        ON p.place = i.place AND IFNULL(p.district,'') = IFNULL(i.district,'')
      WHERE 1=1
        AND (? IS NULL OR i.pub_date >= ?)
        AND (? IS NULL OR i.pub_date <= ?)
      GROUP BY i.place, i.district, p.lat, p.lon
      ORDER BY count DESC
    `;
    return all(sql, [from, from, to, to]);
  },

  async placesMissingCoords({ limit }) {
    const sql = `
      SELECT DISTINCT i.place as place, i.district as district
      FROM incidents i
      LEFT JOIN places p
        ON p.place = i.place AND IFNULL(p.district,'') = IFNULL(i.district,'')
      WHERE i.place IS NOT NULL AND i.place <> ''
        AND (p.lat IS NULL OR p.lon IS NULL)
      LIMIT ?
    `;
    return all(sql, [limit]);
  },
};
