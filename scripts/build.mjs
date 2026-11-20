// 許可リスト(allowlist.json)の番組だけRSSを取得して dist/ にアプリ一式を書き出す
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

const ROOT = new URL("..", import.meta.url);
const DIST = new URL("dist/", ROOT);
const UA = "kids-radio/1.0 (private family podcast player)";

const hash = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
const text = (v) => {
  if (v == null) return "";
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v["#text"] ?? v.__cdata ?? "");
  return String(v);
};
const plain = (html, max = 400) => {
  const s = text(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
};
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// itunes:duration は "1234" / "20:34" / "1:02:03" のどれか
function seconds(d) {
  const s = text(d).trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  return s.split(":").map(Number).reduce((a, n) => a * 60 + (n || 0), 0);
}

async function get(url) {
  let res;
  try { res = await fetch(url, { headers: { "User-Agent": UA } }); }
  catch (e) { throw new Error(`つながりません（${e.message}）: ${url}`); }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res;
}

async function resolveFeed(entry) {
  if (entry.feed) return entry.feed;
  const m = String(entry.apple || "").match(/id(\d+)/);
  if (!m) throw new Error(`feed も apple のURLもありません: ${JSON.stringify(entry)}`);
  const res = await get(`https://itunes.apple.com/lookup?id=${m[1]}&entity=podcast`);
  const json = await res.json();
  const feed = json.results?.[0]?.feedUrl;
  if (!feed) throw new Error(`RSSが見つかりません（Apple限定配信の番組かもしれません）: ${entry.apple}`);
  return feed;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  cdataPropName: "__cdata",
});

function parseFeed(xml, feedUrl, entry, cfg) {
  const ch = parser.parse(xml)?.rss?.channel;
  if (!ch) throw new Error(`RSSとして読めません: ${feedUrl}`);
  const showImage = ch["itunes:image"]?.["@href"] || text(ch.image?.url);
  const hide = asArray(entry.hideEpisodes).map(String);

  const episodes = [];
  for (const it of asArray(ch.item)) {
    const audio = asArray(it.enclosure).find((e) => e?.["@url"])?.["@url"];
    if (!audio) continue;
    const title = plain(it.title, 200);
    const guid = text(it.guid) || audio;
    if (cfg.hideExplicit && /^(yes|true|explicit)$/i.test(text(it["itunes:explicit"]))) continue;
    if (hide.some((h) => h && (title.includes(h) || guid === h))) continue;
    const date = Date.parse(text(it.pubDate));
    episodes.push({
      id: hash(guid),
      title,
      date: Number.isNaN(date) ? null : new Date(date).toISOString(),
      duration: seconds(it["itunes:duration"]),
      audio,
      image: it["itunes:image"]?.["@href"] || null,
      description: plain(it["itunes:summary"] ?? it.description),
    });
  }
  episodes.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return {
    id: hash(feedUrl),
    title: plain(ch.title, 200),
    author: plain(ch["itunes:author"], 200),
    image: showImage || null,
    description: plain(ch["itunes:summary"] ?? ch.description, 300),
    episodes: episodes.slice(0, entry.maxEpisodes || cfg.maxEpisodesPerShow || 50),
  };
}

async function main() {
  const cfg = JSON.parse(await readFile(new URL("allowlist.json", ROOT), "utf8"));
  const shows = [];
  const errors = [];

  for (const entry of asArray(cfg.shows)) {
    try {
      const feedUrl = await resolveFeed(entry);
      const xml = await (await get(feedUrl)).text();
      const show = parseFeed(xml, feedUrl, entry, cfg);
      shows.push(show);
      console.log(`OK  ${show.title}（${show.episodes.length}話）`);
    } catch (e) {
      errors.push(e.message);
      console.warn(`NG  ${e.message}`);
    }
  }

  await rm(DIST, { recursive: true, force: true });
  await cp(new URL("web/", ROOT), DIST, { recursive: true });
  await mkdir(new URL("data/", DIST), { recursive: true });
  const updated = new Date().toISOString();
  await writeFile(new URL("data/shows.json", DIST), JSON.stringify({ updated, shows }));
  // ビルドごとにキャッシュ名を変えて、iPadに新しい版を届ける
  const sw = await readFile(new URL("sw.js", DIST), "utf8");
  await writeFile(new URL("sw.js", DIST), sw.replace("__BUILD__", hash(updated)));

  console.log(`\n${shows.length}番組を書き出しました（失敗 ${errors.length}件）`);
  if (shows.length === 0 && asArray(cfg.shows).length > 0) process.exit(1);
}

main();
