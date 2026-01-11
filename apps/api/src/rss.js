// apps/api/src/rss.js
import { parseStringPromise } from "xml2js";

function toIsoDate(pubDate) {
  // RSS uses e.g. "Sat, 10 Jan 2026 22:10:01 +0000"
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export async function parseRss(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "statistika-hasici-stc/0.1 (github.com/martypetrzel-lab/statistika-hasici-stc)",
      "Accept-Language": "cs,en;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();

  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    trim: true,
    mergeAttrs: true,
  });

  const channel = parsed?.rss?.channel;
  const itemsRaw = channel?.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];

  const items = itemsRaw.map((it) => ({
    title: it?.title ?? "",
    link: it?.link ?? "",
    description: it?.description ?? "",
    guid: typeof it?.guid === "object" ? (it?.guid?._ ?? "") : (it?.guid ?? ""),
    pubDate: it?.pubDate ?? "",
    pubDateIso: toIsoDate(it?.pubDate ?? ""),
  }));

  return {
    title: channel?.title ?? "",
    link: channel?.link ?? "",
    lastBuildDate: channel?.lastBuildDate ?? "",
    items,
  };
}
