import pg from "pg";
const { Pool } = pg;

let pool;

/**
 * Railway: DATABASE_URL je v env automaticky (pokud přidáš Postgres plugin).
 * Lokálně: nastav DATABASE_URL ručně (nebo použij Railway PG proxy).
 */
export async function initDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Missing DATABASE_URL. Na Railway přidej PostgreSQL plugin nebo nastav env DATABASE_URL."
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "0"
          ? false
          : { rejectUnauthorized: false }
    });
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT,
      pub_date TIMESTAMPTZ,
      place TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_incidents_pub_date ON incidents(pub_date DESC);`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_incidents_place ON incidents(place);`
  );
}

function parsePubDate(pubDateStr) {
  if (!pubDateStr) return null;
  const d = new Date(pubDateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function upsertIncidents(items) {
  if (!pool) throw new Error("DB not initialized");

  let upserted = 0;

  for (const it of items) {
    const pubDateIso = parsePubDate(it.pubDate);

    const r = await pool.query(
      `
      INSERT INTO incidents (id, title, link, pub_date, place)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        link = EXCLUDED.link,
        pub_date = EXCLUDED.pub_date,
        place = EXCLUDED.place
      `,
      [
        String(it.id),
        String(it.title || ""),
        String(it.link || ""),
        pubDateIso,
        it.place
      ]
    );

    upserted += r.rowCount ? 1 : 0;
  }

  return { upserted };
}

export async function getIncidents({ limit = 200 } = {}) {
  if (!pool) throw new Error("DB not initialized");

  const r = await pool.query(
    `
    SELECT id, title, link, pub_date, place
    FROM incidents
    ORDER BY pub_date DESC NULLS LAST, created_at DESC
    LIMIT $1
    `,
    [Number(limit)]
  );

  return r.rows;
}

export async function getPlaces({ limit = 200 } = {}) {
  if (!pool) throw new Error("DB not initialized");

  const r = await pool.query(
    `
    SELECT place, COUNT(*)::int AS count
    FROM incidents
    WHERE place IS NOT NULL AND place <> ''
    GROUP BY place
    ORDER BY count DESC, place ASC
    LIMIT $1
    `,
    [Number(limit)]
  );

  return r.rows;
}

export async function getPlacesStats({ from = null, to = null, limit = 30 } = {}) {
  if (!pool) throw new Error("DB not initialized");

  const where = ["place IS NOT NULL AND place <> ''"];
  const params = [];
  let p = 1;

  if (from) {
    where.push(`pub_date >= $${p++}`);
    params.push(new Date(from).toISOString());
  }

  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    where.push(`pub_date <= $${p++}`);
    params.push(end.toISOString());
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  params.push(Number(limit));

  const r = await pool.query(
    `
    SELECT place, COUNT(*)::int AS count
    FROM incidents
    ${whereSql}
    GROUP BY place
    ORDER BY count DESC, place ASC
    LIMIT $${p++}
    `,
    params
  );

  return r.rows;
}

// kompatibilita s ingest.js (zatím bez geocode)
export async function countGeocodedAttempts() {
  return 0;
}
