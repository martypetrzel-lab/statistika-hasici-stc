// apps/api/src/rss.js
import Parser from "rss-parser";

const parser = new Parser();

export async function parseRss(url) {
  const feed = await parser.parseURL(url);
  return feed.items || [];
}
