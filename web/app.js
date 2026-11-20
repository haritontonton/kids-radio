// おうちラジオ：許可された番組だけを表示・再生する
const $ = (id) => document.getElementById(id);
const view = $("view");
const audio = $("audio");

// ---- 保存（iPadのこの端末だけに保存） ----
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const progress = store.get("progress", {}); // epId -> { t, d, done }
const saveProgress = () => store.set("progress", progress);

let data = { shows: [] };
let current = null; // { show, ep }

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
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const img = (src) => el("img", { src: src || "icons/icon-192.png", alt: "", loading: "lazy", referrerpolicy: "no-referrer" });

// ---- 画面 ----
function renderHome() {
  $("heading").textContent = "おうちラジオ";
  $("back").hidden = true;
  view.replaceChildren();
  if (!data.shows.length) {
    view.append(el("div", { class: "empty" }, "まだ番組がありません。", el("br"), "おうちの人に追加してもらってね。"));
    return;
  }
  view.append(el("div", { class: "grid" },
    data.shows.map((s) => el("button", { class: "show-card", onclick: () => (location.hash = `#/show/${s.id}`) },
      img(s.image), el("div", { class: "t" }, s.title)))));
  if (data.updated) view.append(el("div", { class: "updated" }, `さいごの更新：${dateJa(data.updated)}`));
}

function renderShow(id) {
  const show = data.shows.find((s) => s.id === id);
  if (!show) return renderHome();
  $("heading").textContent = show.title;
  $("back").hidden = false;
  view.replaceChildren(
    el("div", { class: "show-head" }, img(show.image),
      el("div", {}, el("strong", {}, show.title), el("p", {}, show.description))),
    el("ul", { class: "eps" }, show.episodes.map((ep) => el("li", {}, episodeRow(show, ep)))));
}

function episodeRow(show, ep) {
  const p = progress[ep.id];
  const dur = ep.duration || p?.d || 0;
  const pct = p && dur ? Math.min(100, (p.t / dur) * 100) : 0;
  const playing = current?.ep.id === ep.id;
  const meta = [dateJa(ep.date), dur ? fmt(dur) : null];
  const tag = p?.done ? el("span", { class: "tag" }, "きいた") : p?.t > 5 ? el("span", { class: "tag" }, "つづきから") : null;
  return el("button", {
      class: `ep${p?.done ? " done" : ""}${playing ? " now" : ""}`,
      onclick: () => play(show, ep),
    },
    el("span", { class: "icon" }, p?.done ? "✓" : playing && !audio.paused ? "♪" : "▶"),
    el("span", { class: "body" },
      el("div", { class: "t" }, ep.title),
      el("div", { class: "m" }, meta.filter(Boolean).map((m) => el("span", {}, m)), tag),
      pct > 0 && !p?.done ? el("div", { class: "bar" }, el("i", { style: `width:${pct}%` })) : null));
}

function route() {
  const m = location.hash.match(/^#\/show\/(\w+)/);
  m ? renderShow(m[1]) : renderHome();
  window.scrollTo(0, 0);
}
$("back").addEventListener("click", () => (location.hash = "#/"));
window.addEventListener("hashchange", route);

// ---- 再生 ----
function play(show, ep) {
  if (current?.ep.id === ep.id) { audio.paused ? audio.play() : audio.pause(); return; }
  current = { show, ep };
  store.set("last", { show: show.id, ep: ep.id });
  audio.src = ep.audio;
  const p = progress[ep.id];
  const start = p && !p.done ? Math.max(0, p.t - 3) : 0;
  audio.addEventListener("loadedmetadata", () => { if (start) audio.currentTime = start; }, { once: true });
  audio.playbackRate = store.get("rate", 1);
  audio.play().catch(() => {});
  showPlayer();
}

function showPlayer() {
  const { show, ep } = current;
  $("player").hidden = false;
  $("p-img").src = ep.image || show.image || "icons/icon-192.png";
  $("p-title").textContent = ep.title;
  $("p-show").textContent = show.title;
  requestAnimationFrame(() => document.body.style.setProperty("--player-h", $("player").offsetHeight + "px"));
  if ("mediaSession" in navigator) {
    const art = ep.image || show.image;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title, artist: show.title, album: "おうちラジオ",
      artwork: art ? [{ src: art, sizes: "512x512" }] : [],
    });
  }
}

const skip = (sec) => { audio.currentTime = Math.max(0, Math.min((audio.duration || 0) - 1, audio.currentTime + sec)); };
$("p-play").addEventListener("click", () => (audio.paused ? audio.play() : audio.pause()));
$("p-back").addEventListener("click", () => skip(-15));
$("p-fwd").addEventListener("click", () => skip(30));
const RATES = [1, 1.25, 1.5, 0.8];
$("p-rate").addEventListener("click", () => {
  const r = RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length] || 1;
  audio.playbackRate = r; store.set("rate", r); $("p-rate").textContent = `${r}x`;
});
$("p-rate").textContent = `${store.get("rate", 1)}x`;

let seeking = false;
$("p-seek").addEventListener("input", () => { seeking = true; $("p-cur").textContent = fmt(($("p-seek").value / 100) * audio.duration); });
$("p-seek").addEventListener("change", () => { audio.currentTime = ($("p-seek").value / 100) * audio.duration; seeking = false; });

let lastSave = 0;
audio.addEventListener("timeupdate", () => {
  if (!current) return;
  const d = audio.duration || 0;
  if (!seeking && d) $("p-seek").value = (audio.currentTime / d) * 100;
  if (!seeking) $("p-cur").textContent = fmt(audio.currentTime);
  $("p-dur").textContent = fmt(d);
  if (Date.now() - lastSave > 5000) {
    lastSave = Date.now();
    const p = (progress[current.ep.id] ||= {});
    p.t = audio.currentTime; p.d = d;
    if (d && audio.currentTime / d > 0.95) p.done = true;
    saveProgress();
  }
});
audio.addEventListener("ended", () => {
  if (!current) return;
  progress[current.ep.id] = { t: 0, d: audio.duration, done: true };
  saveProgress(); route();
});
const syncBtn = () => {
  $("p-play").textContent = audio.paused ? "▶" : "❚❚";
  $("p-play").setAttribute("aria-label", audio.paused ? "再生" : "一時停止");
  if (location.hash.startsWith("#/show/")) route();
};
audio.addEventListener("play", syncBtn);
audio.addEventListener("pause", () => {
  syncBtn();
  if (current) { (progress[current.ep.id] ||= {}).t = audio.currentTime; saveProgress(); }
});

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  try { ms.setActionHandler("seekbackward", () => skip(-15)); } catch {}
  try { ms.setActionHandler("seekforward", () => skip(30)); } catch {}
}

// ---- 起動 ----
async function load() {
  try {
    const res = await fetch("data/shows.json", { cache: "no-cache" });
    data = await res.json();
  } catch {
    view.replaceChildren(el("div", { class: "empty" }, "読みこめませんでした。", el("br"), "インターネットにつながっているか見てね。"));
    return;
  }
  // 前回きいていたものを再生バーに出しておく（自動では再生しない）
  const last = store.get("last");
  const show = last && data.shows.find((s) => s.id === last.show);
  const ep = show?.episodes.find((e) => e.id === last.ep);
  if (show && ep) {
    current = { show, ep };
    audio.src = ep.audio;
    const p = progress[ep.id];
    if (p && !p.done) audio.addEventListener("loadedmetadata", () => (audio.currentTime = p.t), { once: true });
    audio.playbackRate = store.get("rate", 1);
    showPlayer();
  }
  route();
}
load();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
