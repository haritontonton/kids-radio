// おうちラジオ：許可された番組だけを表示・再生する
const $ = (id) => document.getElementById(id);
const view = $("view");
const audio = $("audio");
const deck = $("player");

// ---- 保存（iPadのこの端末だけに保存） ----
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const progress = store.get("progress", {}); // epId -> { t, d, done, at }
const saveProgress = () => store.set("progress", progress);
let favs = store.get("favs", []);           // [{ show, ep }]
const isFav = (epId) => favs.some((f) => f.ep === epId);
function toggleFav(show, ep) {
  favs = isFav(ep.id) ? favs.filter((f) => f.ep !== ep.id) : [{ show: show.id, ep: ep.id }, ...favs];
  store.set("favs", favs);
  syncFavBtn();
  route(false);
}

let data = { shows: [] };
let current = null; // { show, ep }
const findEp = (showId, epId) => {
  const show = data.shows.find((s) => s.id === showId);
  const ep = show?.episodes.find((e) => e.id === epId);
  return show && ep ? { show, ep } : null;
};
const findEpAnywhere = (epId) => {
  for (const show of data.shows) {
    const ep = show.episodes.find((e) => e.id === epId);
    if (ep) return { show, ep };
  }
  return null;
};

// ---- 小物 ----
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};
const dateJa = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const img = (src) => el("img", { src: src || "icons/icon-192.png", alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="5.5" y="4.5" width="4.5" height="15" rx="1.2"/><rect x="14" y="4.5" width="4.5" height="15" rx="1.2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2 6.4 20.2l1.1-6.3L2.9 9.5l6.3-.9z"/></svg>',
  go: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="#2f3238" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2" stroke-linecap="round"/></svg>',
};

// ---- 画面 ----
function setHeader(title, back) {
  $("heading").textContent = title;
  $("back").hidden = !back;
}
function setTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
}
const empty = (iconHtml, ...lines) =>
  el("div", { class: "empty" }, el("div", { html: iconHtml }), lines.flatMap((l, i) => (i ? [el("br"), l] : [l])));

function renderHome() {
  setHeader("おうちラジオ", false); setTab("home");
  if (!data.shows.length) {
    view.replaceChildren(empty(ICON.star, "まだ番組がありません。", "おうちの人に追加してもらってね。"));
    return;
  }
  view.replaceChildren(el("div", { class: "grid" },
    data.shows.map((s) => el("button", { class: "show-card", onclick: () => (location.hash = `#/show/${s.id}`) },
      img(s.image),
      el("div", { class: "plate" },
        el("div", { class: "txt" },
          el("div", { class: "t" }, s.title),
          el("div", { class: "m", html: ICON.clock }, `更新 ${dateJa(s.episodes[0]?.date || data.updated)}`)),
        el("span", { class: "go", html: ICON.go }))))));
}

function renderShow(id) {
  const show = data.shows.find((s) => s.id === id);
  if (!show) return renderHome();
  setHeader(show.title, true); setTab("home");
  view.replaceChildren(
    el("div", { class: "show-head" }, img(show.image),
      el("div", {}, el("div", { class: "t" }, show.title), el("p", {}, show.description))),
    el("ul", { class: "eps" }, show.episodes.map((ep) => el("li", {}, episodeRow(show, ep, false)))));
}

function renderFav() {
  setHeader("お気に入り", false); setTab("fav");
  const list = favs.map((f) => findEp(f.show, f.ep) || findEpAnywhere(f.ep)).filter(Boolean);
  if (!list.length) {
    view.replaceChildren(empty(ICON.star, "まだお気に入りはありません。", "☆ をおすと ここに入るよ。"));
    return;
  }
  view.replaceChildren(el("ul", { class: "eps" }, list.map(({ show, ep }) => el("li", {}, episodeRow(show, ep, true)))));
}

function renderDone() {
  setHeader("きいた", false); setTab("done");
  const list = Object.entries(progress)
    .filter(([, p]) => p.at && (p.done || p.t > 5))
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => findEpAnywhere(id)).filter(Boolean);
  if (!list.length) {
    view.replaceChildren(empty(ICON.clock, "まだ きいた番組はありません。"));
    return;
  }
  view.replaceChildren(el("ul", { class: "eps" }, list.map(({ show, ep }) => el("li", {}, episodeRow(show, ep, true)))));
}

function episodeRow(show, ep, withShow) {
  const p = progress[ep.id];
  const dur = ep.duration || p?.d || 0;
  const pct = p && dur ? Math.min(100, (p.t / dur) * 100) : 0;
  const now = current?.ep.id === ep.id;
  const tag = p?.done ? el("span", { class: "tag ok" }, "きいた") : p?.t > 5 ? el("span", { class: "tag" }, "つづきから") : null;
  const icon = p?.done && !now ? ICON.check : now && !audio.paused ? ICON.pause : ICON.play;
  return el("div", { class: `ep${p?.done ? " done" : ""}${now ? " now" : ""}` },
    el("button", { class: "main", onclick: () => play(show, ep) },
      el("span", { class: "pb", html: icon }),
      el("span", { class: "body" },
        el("div", { class: "t" }, ep.title),
        el("div", { class: "m" },
          withShow ? el("span", { class: "sh" }, show.title) : null,
          el("span", {}, dateJa(ep.date)), dur ? el("span", {}, fmt(dur)) : null, tag),
        pct > 0 && !p?.done ? el("div", { class: "bar" }, el("i", { style: `width:${pct}%` })) : null)),
    el("button", { class: `star${isFav(ep.id) ? " on" : ""}`, "aria-label": "お気に入り", html: ICON.star, onclick: () => toggleFav(show, ep) }));
}

function route(scrollTop = true) {
  const h = location.hash;
  const m = h.match(/^#\/show\/(\w+)/);
  const keep = view.scrollTop;
  if (m) renderShow(m[1]);
  else if (h === "#/fav") renderFav();
  else if (h === "#/done") renderDone();
  else renderHome();
  view.scrollTop = scrollTop ? 0 : keep;
}
$("back").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/")));
window.addEventListener("hashchange", () => route());
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => (location.hash = { home: "#/", fav: "#/fav", done: "#/done" }[b.dataset.tab])));

// ---- 再生 ----
function play(show, ep) {
  if (current?.ep.id === ep.id) { audio.paused ? audio.play() : audio.pause(); return; }
  load(show, ep);
  audio.play().catch(() => {});
}
function load(show, ep) {
  current = { show, ep };
  store.set("last", { show: show.id, ep: ep.id });
  audio.src = ep.audio;
  const p = progress[ep.id];
  const start = p && !p.done ? Math.max(0, p.t - 3) : 0;
  if (start) audio.addEventListener("loadedmetadata", () => (audio.currentTime = start), { once: true });
  audio.playbackRate = rate;
  showPlayer();
}

function showPlayer() {
  const { show, ep } = current;
  setLcd(ep.title);
  $("p-fav").hidden = false;
  syncFavBtn();
  $("p-dur").textContent = fmt(ep.duration);
  if ("mediaSession" in navigator) {
    const art = ep.image || show.image;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title, artist: show.title, album: "おうちラジオ",
      artwork: art ? [{ src: art, sizes: "512x512" }] : [],
    });
  }
}
// 長いタイトルは電光掲示板のように流す
function setLcd(text) {
  const box = $("p-title").parentElement;
  $("p-title").textContent = text;
  box.classList.remove("scroll");
  requestAnimationFrame(() => {
    const over = $("p-title").scrollWidth - box.clientWidth;
    if (over > 4) {
      box.style.setProperty("--shift", `-${$("p-title").scrollWidth + 20}px`);
      box.style.setProperty("--dur", `${Math.max(8, $("p-title").scrollWidth / 40)}s`);
      box.classList.add("scroll");
    }
  });
}
function syncFavBtn() { if (current) $("p-fav").classList.toggle("on", isFav(current.ep.id)); }
$("p-fav").addEventListener("click", () => current && toggleFav(current.show, current.ep));

const skip = (sec) => { audio.currentTime = Math.max(0, Math.min((audio.duration || 0) - 1, audio.currentTime + sec)); };
$("p-play").addEventListener("click", () => {
  if (!current) return;
  audio.paused ? audio.play() : audio.pause();
});
$("p-back").addEventListener("click", () => skip(-15));
$("p-fwd").addEventListener("click", () => skip(30));

// 再生速度のつまみ
const RATES = [0.8, 1, 1.25, 1.5];
const ANGLES = [-120, -40, 40, 120];
let rate = store.get("rate", 1);
if (!RATES.includes(rate)) rate = 1;
function syncRate() {
  $("rate-val").textContent = `${rate}x`;
  $("rate-needle").style.setProperty("--rot", `${ANGLES[RATES.indexOf(rate)]}deg`);
  audio.playbackRate = rate;
}
$("p-rate").addEventListener("click", () => {
  rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
  store.set("rate", rate); syncRate();
});
syncRate();

// 再生位置のダイヤル
const seek = $("p-seek");
let seeking = false;
const setPct = (v) => seek.style.setProperty("--pct", `${v / 10}%`);
seek.addEventListener("input", () => {
  seeking = true; setPct(seek.value);
  $("p-cur").textContent = fmt((seek.value / 1000) * (audio.duration || 0));
});
seek.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  seeking = false;
});

let lastSave = 0;
audio.addEventListener("timeupdate", () => {
  if (!current) return;
  const d = audio.duration || current.ep.duration || 0;
  if (!seeking && d) { seek.value = (audio.currentTime / d) * 1000; setPct(seek.value); }
  if (!seeking) $("p-cur").textContent = fmt(audio.currentTime);
  $("p-dur").textContent = fmt(d);
  if (Date.now() - lastSave > 5000) {
    lastSave = Date.now();
    const p = (progress[current.ep.id] ||= {});
    p.t = audio.currentTime; p.d = d; p.at = Date.now();
    if (d && audio.currentTime / d > 0.95) p.done = true;
    saveProgress();
  }
});
audio.addEventListener("ended", () => {
  if (!current) return;
  progress[current.ep.id] = { t: 0, d: audio.duration, done: true, at: Date.now() };
  saveProgress(); route(false);
});
const syncPlaying = () => {
  const on = !audio.paused;
  if (on && deck.hidden) { deck.hidden = false; deck.classList.add("pop"); }
  deck.classList.toggle("playing", on);
  $("lamp").classList.toggle("on", on);
  $("p-play").setAttribute("aria-label", on ? "一時停止" : "再生");
  route(false);
};
audio.addEventListener("play", syncPlaying);
audio.addEventListener("pause", () => {
  syncPlaying();
  if (current) { const p = (progress[current.ep.id] ||= {}); p.t = audio.currentTime; p.at = Date.now(); saveProgress(); }
});

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  try { ms.setActionHandler("seekbackward", () => skip(-15)); } catch {}
  try { ms.setActionHandler("seekforward", () => skip(30)); } catch {}
}

// ---- 起動 ----
async function start() {
  try {
    const res = await fetch("data/shows.json", { cache: "no-cache" });
    data = await res.json();
  } catch {
    view.replaceChildren(empty(ICON.clock, "読みこめませんでした。", "インターネットにつながっているか見てね。"));
    return;
  }
  // 再生パネルは、何かを再生するまで出さない（前回の続きは一覧の「つづきから」で分かる）
  route();
}
start();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
