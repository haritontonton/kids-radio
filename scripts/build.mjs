// 許可リスト(allowlist.json)の番組だけRSSを取得して dist/ にアプリ一式を書き出す
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

const ROOT = new URL("..", import.meta.url);
const DIST = new URL("dist/", ROOT);
const UA = "kids-radio/1.0 (private family podcast player)";

const hash = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
// XMLの文字参照（&amp; や &#12354; など）を自前で戻す
const decode = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");
const text = (v) => {
  if (v == null) return "";
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return v.__cdata != null ? String(v.__cdata) : decode(v["#text"] ?? "");
  return decode(v);
};
const attr = (o, k) => (o?.[k] == null ? null : decode(o[k]));
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

const norm = (s) => String(s).normalize("NFKC").replace(/[\s『』「」【】\[\]()（）]/g, "").toLowerCase();

async function resolveFeed(entry) {
  if (entry.feed) return entry.feed;
  // 番組名で Apple Podcasts を検索（Amazon Music の番組などに使う）
  if (entry.search && !entry.apple) {
    const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&country=JP&limit=20&term=${encodeURIComponent(entry.search)}`;
    const results = (await (await get(url)).json()).results || [];
    const hit = results.find((r) => norm(r.collectionName) === norm(entry.search));
    if (!hit?.feedUrl) {
      const names = results.slice(0, 5).map((r) => r.collectionName).join(" / ");
      throw new Error(`「${entry.search}」と同じ名前の番組が見つかりません（候補: ${names || "なし"}）`);
    }
    console.log(`    検索: ${entry.search} → id${hit.collectionId} ${hit.feedUrl}`);
    return hit.feedUrl;
  }
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
  processEntities: false, // 長い番組説明で上限エラーになるので、文字参照は decode() で戻す
});

function parseFeed(xml, feedUrl, entry, cfg) {
  const ch = parser.parse(xml)?.rss?.channel;
  if (!ch) throw new Error(`RSSとして読めません: ${feedUrl}`);
  const showImage = attr(ch["itunes:image"], "@href") || text(ch.image?.url);
  const hide = asArray(entry.hideEpisodes).map(String);

  const episodes = [];
  for (const it of asArray(ch.item)) {
    const audio = attr(asArray(it.enclosure).find((e) => e?.["@url"]), "@url");
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
      image: attr(it["itunes:image"], "@href"),
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
