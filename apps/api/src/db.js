// apps/api/src/db.js
import "dotenv/config";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "..", "..", "..", "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "hasici.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  link TEXT,
  pub_date TEXT NOT NULL,          -- ISO
  category TEXT,
  subtype TEXT,
  place TEXT,
  district TEXT,
  status TEXT,
  ended_at TEXT,
  duration_minutes INTEGER,
  raw_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_pub_date ON incidents(pub_date);
CREATE INDEX IF NOT EXISTS idx_incidents_place ON incidents(place);
CREATE INDEX IF NOT EXISTS idx_incidents_district ON incidents(district);
CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);

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

CREATE INDEX IF NOT EXISTS idx_places_latlon ON places(lat, lon);
`);

const upsertIncidentStmt = db.prepare(`
INSERT INTO incidents (
  guid, title, link, pub_date, category, subtype, place, district, status, ended_at, duration_minutes, raw_description
) VALUES (
  @guid, @title, @link, @pub_date, @category, @subtype, @place, @district, @status, @ended_at, @duration_minutes, @raw_description
)
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
  raw_description=excluded.raw_description,
  updated_at=datetime('now');
`);

const getPlaceStmt = db.prepare(`
SELECT place, district, lat, lon, provider
FROM places
WHERE place = @place AND (district IS @district OR district = @district)
LIMIT 1;
`);

const upsertPlaceCoordsStmt = db.prepare(`
INSERT INTO places (place, district, lat, lon, provider)
VALUES (@place, @district, @lat, @lon, @provider)
ON CONFLICT(place, district) DO UPDATE SET
  lat=excluded.lat,
  lon=excluded.lon,
  provider=excluded.provider,
  updated_at=datetime('now');
`);

const placesMissingCoordsStmt = db.prepare(`
SELECT place, district
FROM places
WHERE (lat IS NULL OR lon IS NULL)
LIMIT @limit;
`);

const ensurePlaceRowStmt = db.prepare(`
INSERT OR IGNORE INTO places (place, district)
VALUES (@place, @district);
`);

const statsPlacesStmt = db.prepare(`
SELECT
  COALESCE(place, 'Neznámé') AS place,
  COALESCE(district, 'Neznámé') AS district,
  COUNT(*) AS count
FROM incidents
GROUP BY COALESCE(place, 'Neznámé'), COALESCE(district, 'Neznámé')
ORDER BY count DESC
LIMIT 200;
`);

const statsCategoriesStmt = db.prepare(`
SELECT
  COALESCE(category, 'Neznámé') AS category,
  COUNT(*) AS count
FROM incidents
GROUP BY COALESCE(category, 'Neznámé')
ORDER BY count DESC;
`);

const statsDistrictsStmt = db.prepare(`
SELECT
  COALESCE(district, 'Neznámé') AS district,
  COUNT(*) AS count
FROM incidents
GROUP BY COALESCE(district, 'Neznámé')
ORDER BY count DESC;
`);

// Mapa: body (jen ty, co mají souřadnice), počet zásahů + rozpad kategorií
const mapPlacesStmt = db.prepare(`
SELECT
  p.place AS place,
  COALESCE(p.district, 'Neznámé') AS district,
  p.lat AS lat,
  p.lon AS lon,
  COUNT(i.id) AS count,
  SUM(CASE WHEN i.category LIKE 'požár%' THEN 1 ELSE 0 END) AS cnt_pozar,
  SUM(CASE WHEN i.category LIKE 'dopravní nehoda%' THEN 1 ELSE 0 END) AS cnt_dn,
  SUM(CASE WHEN i.category LIKE 'technická pomoc%' THEN 1 ELSE 0 END) AS cnt_tp,
  SUM(CASE WHEN i.category LIKE 'planý poplach%' THEN 1 ELSE 0 END) AS cnt_pp
FROM places p
JOIN incidents i
  ON i.place = p.place AND (i.district IS p.district OR i.district = p.district)
WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
GROUP BY p.place, COALESCE(p.district, 'Neznámé'), p.lat, p.lon
ORDER BY count DESC
LIMIT 2000;
`);

export const stmts = {
  // inserts/updates
  upsertIncident: (row) => {
    // udržujme i tabulku places
    if (row.place) {
      ensurePlaceRowStmt.run({
        place: row.place,
        district: row.district || null,
      });
    }
    upsertIncidentStmt.run(row);
  },

  getPlace: (args) => getPlaceStmt.get(args),
  upsertPlaceCoords: (args) => upsertPlaceCoordsStmt.run(args),
  placesMissingCoords: ({ limit }) => placesMissingCoordsStmt.all({ limit }),

  // stats
  statsPlaces: (_filter = {}) => statsPlacesStmt.all(),
  statsCategories: (_filter = {}) => statsCategoriesStmt.all(),
  statsDistricts: (_filter = {}) => statsDistrictsStmt.all(),

  // map
  mapPlaces: (_filter = {}) => mapPlacesStmt.all(),
};

export { db, DB_PATH, DATA_DIR };
