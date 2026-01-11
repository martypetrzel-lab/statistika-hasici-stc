import { parseStringPromise } from "xml2js";
import he from "he";

export async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "hasici-stc-api/0.1 (+https://github.com/)",
      "accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7"
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fetch failed ${res.status} ${res.statusText} for ${url}. Body: ${body.slice(0, 300)}`);
  }
  return await res.text();
}

export async function parseRssXml(xmlText) {
  const obj = await parseStringPromise(xmlText, {
    explicitArray: false,
    trim: true,
    mergeAttrs: true
  });

  const channel = obj?.rss?.channel;
  const itemsRaw = channel?.item ?? [];
  const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

  return items.filter(Boolean).map(normalizeItem);
}

/**
 * title typicky:
 * "dopravní nehoda - uvolnění komunikace, odtažení - Kutná Hora"
 * "planý poplach - Bobnice"
 */
function splitTitle(title) {
  const parts = String(title || "").split(" - ").map(s => s.trim()).filter(Boolean);

  if (parts.length >= 3) {
    return {
      category: parts[0] || null,
      subtype: parts.slice(1, parts.length - 1).join(" - ") || null,
      place: parts[parts.length - 1] || null
    };
  }

  if (parts.length === 2) {
    return {
      category: parts[0] || null,
      subtype: null,
      place: parts[1] || null
    };
  }

  return {
    category: parts[0] || null,
    subtype: null,
    place: null
  };
}

/**
 * description přichází HTML-escaped: "stav: ukončená&lt;br&gt;ukončení: ...&lt;br&gt;Kladno&lt;br&gt;okres ..."
 */
function decodeDescription(raw) {
  const decoded = he.decode(String(raw || ""));
  return decoded
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r/g, "")
    .trim();
}

function parseKm(text) {
  const m = text.match(/\bkm:\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function parseRoad(text) {
  const m = text.match(/\b(D[0-9]+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function parseStatus(text) {
  const m = text.match(/^\s*stav:\s*(.+)\s*$/im);
  return m ? m[1].trim() : null;
}

function parseDistrict(text) {
  const m = text.match(/^\s*okres\s+(.+)\s*$/im);
  return m ? m[1].trim() : null;
}

/**
 * "ukončení: 1. října 2026, 21:32"
 * Vrátí ISO bez timezone: "2026-10-01T21:32:00"
 * Pokud se nepovede parse, vrátí null.
 */
function parseEndTimeIsoLocal(text) {
  const m = text.match(/^\s*ukončen[íi]\s*:\s*(.+)\s*$/im);
  if (!m) return null;

  const s = m[1].trim();

  // očekáváme: "D. <měsíc> YYYY, HH:MM"
  const mm = s.match(/^(\d{1,2})\.\s*([^\s]+)\s+(\d{4}),\s*(\d{1,2}):(\d{2})$/i);
  if (!mm) return null;

  const day = Number(mm[1]);
  const monthWord = mm[2].toLowerCase();
  const year = Number(mm[3]);
  const hour = Number(mm[4]);
  const minute = Number(mm[5]);

  const monthMap = {
    "ledna": 1,
    "února": 2,
    "brezna": 3,
    "března": 3,
    "dubna": 4,
    "kvetna": 5,
    "května": 5,
    "cervna": 6,
    "června": 6,
    "cervence": 7,
    "července": 7,
    "srpna": 8,
    "zari": 9,
    "září": 9,
    "rijna": 10,
    "října": 10,
    "listopadu": 11,
    "prosince": 12
  };

  // zkus odstranit diakritiku jednoduše (pro jistotu)
  const normalized = monthWord
    .replace(/á/g, "a").replace(/č/g, "c").replace(/ď/g, "d").replace(/é/g, "e")
    .replace(/ě/g, "e").replace(/í/g, "i").replace(/ň/g, "n").replace(/ó/g, "o")
    .replace(/ř/g, "r").replace(/š/g, "s").replace(/ť/g, "t").replace(/ú/g, "u")
    .replace(/ů/g, "u").replace(/ý/g, "y").replace(/ž/g, "z");

  const month = monthMap[monthWord] ?? monthMap[normalized];
  if (!month) return null;

  const pad = (n) => String(n).padStart(2, "0");
  if (![day, year, hour, minute].every(Number.isFinite)) return null;

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
}

function incidentIdFromLink(link) {
  const m = String(link || "").match(/\/zasahy-jpo\/(\d+)\/?$/i);
  return m ? m[1] : null;
}

function normalizeItem(item) {
  const title = String(item?.title ?? "").trim();
  const link = String(item?.link ?? "").trim();
  const guid = (typeof item?.guid === "object" ? item?.guid?._ : item?.guid) ?? null;
  const pubDate = String(item?.pubDate ?? "").trim();

  const { category, subtype, place } = splitTitle(title);

  const rawDescription = decodeDescription(item?.description ?? "");
  const status = parseStatus(rawDescription);
  const district = parseDistrict(rawDescription);
  const km = parseKm(rawDescription);
  const road = parseRoad(rawDescription);
  const end_time = parseEndTimeIsoLocal(rawDescription);

  const incident_id = incidentIdFromLink(link) || String(guid || "").replace(/^RSS_FEED_/, "") || null;

  // pubDate je v RSS RFC-822, převedeme do ISO UTC (reálná data)
  const pubIso = pubDate ? new Date(pubDate).toISOString() : null;

  return {
    incident_id,
    title,
    link,
    guid: guid ? String(guid) : null,
    pub_date: pubIso,
    category,
    subtype,
    place,
    district,
    status,
    end_time,
    road,
    km,
    raw_description: rawDescription
  };
}
