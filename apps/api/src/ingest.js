// apps/api/src/ingest.js
import { parseRss } from "./rss.js";
import { stmts } from "./db.js";
import { geocodePlace } from "./geocode.js";

function parseEndedAt(text) {
  if (!text) return null;
  return text.trim();
}

function htmlBrToLines(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseDescription(descHtml) {
  const lines = htmlBrToLines(descHtml)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let status = null;
  let ended_at = null;
  let place = null;
  let district = null;

  for (const l of lines) {
    if (l.toLowerCase().startsWith("stav:")) status = l.split(":").slice(1).join(":").trim();
    else if (l.toLowerCase().startsWith("ukončení:"))
      ended_at = parseEndedAt(l.split(":").slice(1).join(":"));
    else if (l.toLowerCase().startsWith("okres"))
      district = l.replace(/^okres\s+/i, "").trim();
  }

  const candidatePlaces = lines.filter(
    (l) =>
      !/^stav:/i.test(l) &&
      !/^ukončení:/i.test(l) &&
      !/^km:/i.test(l) &&
      !/^okres/i.test(l) &&
      !/^D\d+/i.test(l)
  );
  if (candidatePlaces.length > 0) {
    place = candidatePlaces[candidatePlaces.length - 1].trim();
  }

  return { status, ended_at, place, district, raw_description: lines.join(" | ") };
}

function parseTitle(title) {
  const parts = String(title || "")
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean);

  const category = parts[0] || null;
  const subtype = parts.length >= 3 ? parts.slice(1, -1).join(" - ") : (parts[1] || null);
  return { category, subtype };
}

// For now keep duration null; we will normalize ended_at to ISO and compute later
function computeDurationMinutes(_pubDateIso, _endedAtIso) {
  return null;
}

async function ensurePlaceCoords(place, district) {
  if (!place) return;

  const existing = await stmts.getPlace({ place, district: district || null });
  if (existing && existing.lat != null && existing.lon != null) return;

  const geo = await geocodePlace(place);
  if (!geo) return;

  await stmts.upsertPlaceCoords({
    place,
    district: district || null,
    lat: geo.lat,
    lon: geo.lon,
    provider: geo.provider,
  });
}

export async function ingestOnce() {
  const rssUrl = process.env.RSS_URL;
  if (!rssUrl) throw new Error("RSS_URL is not set");

  const feed = await parseRss(rssUrl);

  let upserted = 0;

  for (const it of feed.items) {
    const { category, subtype } = parseTitle(it.title);
    const parsed = parseDescription(it.description);

    const pub_date = it.pubDateIso;
    const duration_minutes = computeDurationMinutes(pub_date, parsed.ended_at);

    await stmts.upsertIncident({
      guid: it.guid,
      title: it.title,
      link: it.link,
      pub_date,
      category,
      subtype,
      place: parsed.place,
      district: parsed.district,
      status: parsed.status,
      ended_at: parsed.ended_at,
      duration_minutes,
      raw_description: parsed.raw_description,
    });

    upserted++;
  }

  const missing = await stmts.placesMissingCoords({ limit: 5 });
  for (const row of missing) {
    await ensurePlaceCoords(row.place, row.district);
  }

  return {
    ok: true,
    fetched: feed.items.length,
    upserted,
    geocoded_attempts: missing.length,
  };
}
