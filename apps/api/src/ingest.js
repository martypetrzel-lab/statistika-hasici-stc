import { fetchText, parseRssXml } from "./rss.js";

export async function ingestFromRss(db, sourceUrl) {
  const startedAt = new Date().toISOString();

  const xml = await fetchText(sourceUrl);
  const items = await parseRssXml(xml);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const it of items) {
    if (!it.incident_id || !it.pub_date || !it.title || !it.link) {
      skipped++;
      continue;
    }

    const existing = await db.get(
      `SELECT incident_id, title, link, guid, pub_date, category, subtype, place, district, status, end_time, road, km, raw_description
       FROM incidents
       WHERE incident_id = ?`,
      [it.incident_id]
    );

    const now = new Date().toISOString();

    if (!existing) {
      await db.run(
        `INSERT INTO incidents (
          incident_id, title, link, guid, pub_date,
          category, subtype, place, district, status,
          end_time, road, km, raw_description, ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          it.incident_id,
          it.title,
          it.link,
          it.guid,
          it.pub_date,
          it.category,
          it.subtype,
          it.place,
          it.district,
          it.status,
          it.end_time,
          it.road,
          it.km,
          it.raw_description,
          now
        ]
      );
      inserted++;
      continue;
    }

    // update jen když se něco změnilo (reálná data, žádné odhady)
    const changed =
      existing.title !== it.title ||
      existing.link !== it.link ||
      existing.guid !== it.guid ||
      existing.pub_date !== it.pub_date ||
      existing.category !== it.category ||
      existing.subtype !== it.subtype ||
      existing.place !== it.place ||
      existing.district !== it.district ||
      existing.status !== it.status ||
      existing.end_time !== it.end_time ||
      existing.road !== it.road ||
      Number(existing.km ?? null) !== Number(it.km ?? null) ||
      existing.raw_description !== it.raw_description;

    if (!changed) {
      skipped++;
      continue;
    }

    await db.run(
      `UPDATE incidents SET
        title = ?, link = ?, guid = ?, pub_date = ?,
        category = ?, subtype = ?, place = ?, district = ?, status = ?,
        end_time = ?, road = ?, km = ?, raw_description = ?, ingested_at = ?
      WHERE incident_id = ?`,
      [
        it.title,
        it.link,
        it.guid,
        it.pub_date,
        it.category,
        it.subtype,
        it.place,
        it.district,
        it.status,
        it.end_time,
        it.road,
        it.km,
        it.raw_description,
        now,
        it.incident_id
      ]
    );
    updated++;
  }

  const finishedAt = new Date().toISOString();

  await db.run(
    `INSERT INTO ingest_runs (
      source_url, started_at, finished_at,
      items_total, items_inserted, items_updated, items_skipped,
      note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sourceUrl,
      startedAt,
      finishedAt,
      items.length,
      inserted,
      updated,
      skipped,
      null
    ]
  );

  return {
    source_url: sourceUrl,
    started_at: startedAt,
    finished_at: finishedAt,
    items_total: items.length,
    items_inserted: inserted,
    items_updated: updated,
    items_skipped: skipped
  };
}
