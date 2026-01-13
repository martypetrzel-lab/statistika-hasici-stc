import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [
      ["guid", "guid"],
      ["dc:identifier", "dcIdentifier"]
    ]
  }
});

function pickPlace(title = "") {
  const s = String(title).trim();

  // nejčastější: "OBEC - něco"
  const dash = s.split(" - ");
  if (dash.length >= 2) return dash[0].trim();

  // "OBEC – něco"
  const endash = s.split(" – ");
  if (endash.length >= 2) return endash[0].trim();

  // "OBEC: něco"
  const colon = s.split(": ");
  if (colon.length >= 2 && colon[0].length <= 40) return colon[0].trim();

  return null;
}

function sanitizeXml(xmlString) {
  if (typeof xmlString !== "string") return "";

  // pryč BOM
  let s = xmlString.replace(/^\uFEFF/, "");

  // někdy bývá něco před prvním tagem -> vezmeme až od prvního "<"
  const i = s.indexOf("<");
  if (i > 0) s = s.slice(i);

  return s;
}

export async function parseRss(xmlString) {
  const xml = sanitizeXml(xmlString);

  // Pojistka: kdyby upstream vrátil něco úplně mimo
  if (!xml.trimStart().startsWith("<")) {
    throw new Error("parseRss: input is not XML (missing '<' at start)");
  }

  const feed = await parser.parseString(xml);

  const items = (feed.items || []).map((it) => {
    const id =
      it.guid ||
      it.dcIdentifier ||
      it.id ||
      it.link ||
      `${it.title || "item"}|${it.pubDate || ""}`;

    return {
      id: String(id),
      title: it.title ? String(it.title) : "",
      link: it.link ? String(it.link) : "",
      pubDate: it.pubDate ? String(it.pubDate) : "",
      place: pickPlace(it.title) || null
    };
  });

  return items;
}
