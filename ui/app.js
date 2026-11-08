"use strict";
/* Elytra UI. All visible text goes through t() — translations are in i18n.js */
const S = {
  page: "home", instances: [], servers: [], settings: {lang: "en"}, versions: [], sys: {},
  current: null, content: [], backups: [], worlds: [], shots: [], itab: "content", pings: {},
  media: "", accounts: [], features: {}, news: null, selfUpdate: null, checking: false,
  browse: {type: "mod", query: "", sort: "relevance", version: "", loader: "", target: "", offset: 0, total: 0, hits: null},
};
const TYPES = ["modpack", "mod", "resourcepack", "shader"];
const SORTS = ["relevance", "downloads", "follows", "newest", "updated"];
const LOADERS = ["vanilla", "fabric", "quilt", "forge"];
const LANG_NAMES = {en: ["English", "EN"], ru: ["Русский", "RU"], uk: ["Українська", "UK"], de: ["Deutsch", "DE"], es: ["Español", "ES"]};
const $ = s => document.querySelector(s);
const ico = (n, cls = "i") => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const safeUrl = u => (u = cdnUrl(u), typeof u === "string" && (u.startsWith("https://") || (S.media && u.startsWith(S.media + "/")) || /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(u))) ? esc(u) : "";
const skinUrl = name => S.media ? `${S.media}/skin/${encodeURIComponent(name || "Steve")}.png` : `https://mc-heads.net/skin/${encodeURIComponent(name || "Steve")}`;
const face = (name, size, extra = "") => `<span class="avatar face" ${extra} style="--s:${size}px;background-image:url('${esc(skinUrl(name))}'),url('${esc(skinUrl(name))}')"></span>`;
const MCIM_CDN = "https://mod.mcimirror.top";
const cdnUrl = u => (S.net && S.net.modrinth === "mirror" && typeof u === "string" && u.startsWith("https://cdn.modrinth.com/")) ? MCIM_CDN + u.slice(24) : u;
const mediaUrl = (iid, kind, name) => S.media ? `${S.media}/${encodeURIComponent(iid)}/${kind}/${encodeURIComponent(name)}` : "";
const ACCENTS = ["", "#3b82f6", "#06b6d4", "#a855f7", "#ec4899", "#ef4444", "#f97316", "#eab308"];
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(".0", "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(".0", "") + "K" : String(n);
const jsArg = v => esc(JSON.stringify(v));

/* ---------- translations ---------- */
function t(key, p = {}) {
  const d = I18N[S.settings.lang] || I18N.en;
  const s = d[key] ?? I18N.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (p[k] ?? m));
}
const tm = m => typeof m === "string" ? m : (m && m.key) ? t(m.key, m.params || {}) : "";
const T = (k, p) => esc(t(k, p));
function applyStaticText() {
  document.documentElement.lang = S.settings.lang || "en";
  document.querySelectorAll("[data-t]").forEach(el => el.textContent = t(el.dataset.t));
}
function fmtTime(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? t("time.hm", {h, m}) : t("time.m", {m: Math.max(m, sec > 0 ? 1 : 0)});
}
function fmtAgo(ts) {
  if (!ts) return t("time.never");
  const d = (Date.now() / 1000 - ts);
  if (d < 60) return t("time.just_now");
  if (d < 3600) return t("time.min_ago", {n: Math.floor(d / 60)});
  if (d < 86400) return t("time.h_ago", {n: Math.floor(d / 3600)});
  return t("time.d_ago", {n: Math.floor(d / 86400)});
}
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " " + t("u.mb") : Math.max(1, Math.round(b / 1024)) + " " + t("u.kb");
const gb = mb => (mb / 1024).toFixed(1) + " " + t("u.gb");
const fmtDate = ts => new Date(ts * 1000).toLocaleString(S.settings.lang || "en", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"});

async function call(name, ...args) {
  const r = await window.pywebview.api[name](...args);
  if (!r.ok) { toast(tm(r.error), "error"); throw new Error(tm(r.error)); }
  return r.data;
}

/* ---------- icons ---------- */
function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function icon(url, name) {
  if (safeUrl(url)) return `<div class="genicon"><img src="${safeUrl(url)}" loading="lazy" alt=""></div>`;
  const h = hue(name), letters = esc(String(name || "?").trim().slice(0, 2).toUpperCase());
  return `<div class="genicon" style="background:linear-gradient(135deg,hsl(${h} 65% 45%),hsl(${(h + 50) % 360} 70% 30%))"><span>${letters}</span></div>`;
}
const loaderName = l => l ? l[0].toUpperCase() + l.slice(1) : "";

/* ---------- navigation ---------- */
function go(page, arg) {
  if (page === "instance" && arg !== S.current) S.itab = "content";
  S.page = page;
  if (page === "instance") S.current = arg;
  document.querySelectorAll(".nav[data-page]").forEach(b => b.classList.toggle("on", b.dataset.page === page || (page === "instance" && b.dataset.page === "library")));
  render();
  $("#main").scrollTop = 0;
}
document.querySelectorAll(".nav[data-page]").forEach(b => b.onclick = () => go(b.dataset.page));

function render() {
  const p = S.page, m = $("#main");
  if (p === "instance") {
    const inst = S.instances.find(i => i.id === S.current);
    if (!inst) return go("library");
    $("#crumb").innerHTML = `<span>${T("nav.library")} /</span> ${esc(inst.name)}`;
    m.innerHTML = `<div class="page">${pageInstance(inst)}</div>`;
    loadTab();
  } else {
    $("#crumb").textContent = t("nav." + p);
    m.innerHTML = `<div class="page">${{home: pageHome, browse: pageBrowse, library: pageLibrary, servers: pageServers, settings: pageSettings, skin: pageSkin, ach: pageAch}[p]()}</div>`;
    if (p === "skin") loadSkin();
    if (p === "ach") loadAch();
    if (p === "home") { loadPopular(); loadNews(); loadHomeStats(); }
    if (p === "browse") { if (!S.browse.hits) doSearch(); else renderResults(); }
    if (p === "servers") pingAll();
  }
  renderChrome();
}

function activeAccount() { return S.accounts.find(a => a.id === S.settings.account); }
function renderChrome() {
  const acc = activeAccount();
  const nick = acc ? acc.name : (S.settings.nick || "Player");
  $("#nickLabel").textContent = streamer() ? t("str.hidden") : nick;
  $("#avatar").style.display = streamer() ? "none" : "";
  $("#strBtn").innerHTML = streamerBtn();
  if ($("#frBtn") && typeof friendsChip === "function") $("#frBtn").innerHTML = friendsChip();
  const av = skinUrl(nick);
  if ($("#avatar").dataset.u !== av) { $("#avatar").dataset.u = av; $("#avatar").style.backgroundImage = `url('${av}'),url('${av}')`; }
  $("#railInst").innerHTML = S.instances.slice(0, 4).map(i =>
    `<div class="rail-inst" title="${esc(i.name)}" onclick='go("instance",${jsArg(i.id)})'>${icon(i.icon, i.name)}${i.running ? '<span class="dot"></span>' : ""}</div>`).join("");
  const run = S.instances.filter(i => i.running);
  $("#runChip").innerHTML = (run.length ? `<div class="chip"><span class="pulse"></span>${T("top.running", {names: run.map(i => i.name).join(", ")})}</div>` : "") + (typeof supChip === "function" ? supChip() : "");
}

/* ---------- home ---------- */
function totalPlaytime() { return S.instances.reduce((a, i) => a + (i.playtime || 0), 0); }
function pageHome() {
  const recent = S.instances.slice(0, 5);
  const statsHtml = `<div class="stats-strip">
    <div class="statcard"><div class="si">${ico("clock")}</div><div><b>${esc(fmtTime(totalPlaytime()))}</b><small>${T("stats.total")}</small></div></div>
    <div class="statcard"><div class="si">${ico("grid")}</div><div><b>${S.instances.length}</b><small>${T("stats.instances")}</small></div></div>
    <div class="statcard"><div class="si">${ico("download")}</div><div><b>${S.instances.reduce((a, i) => a + Object.keys(i.content || {}).length, 0)}</b><small>${T("stats.mods")}</small></div></div>
    <div class="statcard"><div class="si">${ico("server")}</div><div><b>${S.servers.length}</b><small>${T("stats.servers")}</small></div></div>
  </div>`;
  const upd = S.selfUpdate ? `<div class="target" style="margin-bottom:16px">${ico("rocket")}${T("self.available", {v: S.selfUpdate.version})}
      <span class="spacer"></span><button class="btn brand" onclick="applySelfUpdate()">${ico("download")}${T("self.install")}</button></div>` : "";
  return `${upd}
  <div class="hero"><div class="hero-in">
    <h1>${T("home.hello", {nick: S.settings.nick || "Player"})} 👋</h1>
    <p>${T("home.sub")}</p>
    <div style="display:flex;gap:10px">
      ${recent[0] ? `<button class="btn brand big" onclick='play(${jsArg(recent[0].id)})'>${ico("play")}${T("home.play_in", {name: recent[0].name})}</button>` : `<button class="btn brand big" onclick="openCreate()">${ico("plus")}${T("home.first")}</button>`}
      <button class="btn big" onclick="go('browse')">${ico("compass")}${T("home.open_browse")}</button>
    </div>
  </div></div>
  ${statsHtml}
  ${funRow()}
  <h2>${T("home.recent")} ${S.instances.length ? `<a onclick="go('library')">${T("home.all")} →</a>` : ""}</h2>
  ${recent.length ? `<div class="grid">${recent.map(instCard).join("")}</div>` : emptyLib()}
  ${playtimeBars()}
  <div id="homeStats"></div>
  <h2>${T("home.pop_mods")} <a onclick="openBrowse('mod')">${T("home.see_all")} →</a></h2>
  <div class="hscroll" id="popMods">${skelMini()}</div>
  <h2>${T("home.pop_packs")} <a onclick="openBrowse('modpack')">${T("home.see_all")} →</a></h2>
  <div class="hscroll" id="popPacks">${skelMini()}</div>
  <div id="newsWrap">${newsHtml()}</div>`;
}
function newsHtml() {
  const n = S.news;
  if (n && !n.items.length && !n.latest.release) return "";
  const latest = n && n.latest.release ? `<span class="chip" style="font-size:12px;font-weight:600">${T("news.release")} ${esc(n.latest.release)} · ${T("news.snapshot")} ${esc(n.latest.snapshot || "—")}</span>` : "";
  const cards = !n ? Array(4).fill('<div class="skel" style="height:210px"></div>').join("")
    : n.items.map(x => `<div class="newscard" ${x.link ? `onclick='openUrl(${jsArg(x.link)})'` : ""}>
        <div class="nimg">${safeUrl(x.image) ? `<img src="${safeUrl(x.image)}" loading="lazy" alt="">` : ""}</div>
        <div class="nbody">${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ""}<b>${esc(x.title)}</b><small>${esc(x.text)}</small></div></div>`).join("");
  return `<h2>${ico("file")}${T("news.title")} ${latest}</h2>${cards ? `<div class="hscroll news">${cards}</div>` : ""}`;
}
async function loadNews() {
  if (!S.news) { try { S.news = await call("get_news"); } catch { S.news = {items: [], latest: {}}; } }
  const w = $("#newsWrap"); if (w) w.innerHTML = newsHtml();
}
async function openUrl(u) { await call("open_url", u); }
function playtimeBars() {
  const list = S.instances.filter(i => i.playtime > 0).sort((a, b) => b.playtime - a.playtime).slice(0, 5);
  if (!list.length) return "";
  const max = list[0].playtime;
  return `<h2>${ico("chart")}${T("stats.most_played")}</h2><div class="panel" style="max-width:none;margin:0"><div class="bars">${list.map(i => `
    <div class="barrow" onclick='go("instance",${jsArg(i.id)})'><div class="ic">${icon(i.icon, i.name)}</div><b>${esc(i.name)}</b>
      <div class="track"><i style="width:${Math.max(3, i.playtime / max * 100)}%"></i></div><span>${esc(fmtTime(i.playtime))}</span></div>`).join("")}</div></div>`;
}
const skelMini = () => Array(5).fill('<div class="skel" style="height:82px"></div>').join("");
async function loadPopular() {
  for (const [type, id] of [["mod", "#popMods"], ["modpack", "#popPacks"]]) {
    call("search", {type, sort: "downloads"}).then(r => {
      const el = $(id); if (!el) return;
      el.innerHTML = r.hits.slice(0, 10).map(h => `
        <div class="mini" onclick='openProject(${jsArg(h.project_id)},${jsArg(type)})'>
          <div class="ic">${icon(h.icon_url, h.title)}</div>
          <div style="min-width:0"><b>${esc(h.title)}</b><small>${esc(h.description)}</small></div>
        </div>`).join("");
    }).catch(() => { const el = $(id); if (el) el.innerHTML = `<small>${T("err.offline")}</small>`; });
  }
}
function openBrowse(type, target) {
  Object.assign(S.browse, {type, offset: 0, hits: null});
  if (target !== undefined) setTarget(target);
  go("browse");
}

/* ---------- library ---------- */
function statusBadge(i) {
  if (i.status === "installing") return `<span class="badge warn"><span class="spin"></span>${T("st.installing")}</span>`;
  if (i.status === "broken") return `<span class="badge err">${T("st.broken")}</span>`;
  if (i.launching) return `<span class="badge warn"><span class="spin"></span>${T("st.launching")}</span>`;
  if (i.running) return `<span class="badge ok">● ${T("st.running")}</span>`;
  return "";
}
function instCard(i) {
  const btn = i.status === "ready" && !i.launching
    ? `<button class="playbtn ${i.running ? "run" : ""}" onclick='event.stopPropagation();${i.running ? "stop" : "play"}(${jsArg(i.id)})'>${ico(i.running ? "stop" : "play")}</button>` : "";
  return `<div class="inst" data-iid="${esc(i.id)}" onclick='go("instance",${jsArg(i.id)})'>
    <div class="ic">${icon(i.icon, i.name)}</div>${statusBadge(i)}${btn}
    <b>${esc(i.name)}</b><small>${esc(loaderName(i.loader))} ${esc(i.mc)}${i.playtime ? " · " + esc(fmtTime(i.playtime)) : ""}</small>
  </div>`;
}
const emptyLib = () => `<div class="empty"><b>${T("lib.empty")}</b>${T("lib.empty_sub")}<br><br><button class="btn brand" onclick="openCreate()">${ico("plus")}${T("lib.create")}</button> <button class="btn" onclick="openImport()">${ico("restore")}${T("im.btn")}</button></div>`;
function pageLibrary() {
  return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h1>${T("nav.library")}</h1><span class="spacer"></span>
    <button class="btn" onclick="call('open_folder')">${ico("folder")}${T("lib.folder")}</button>
    <button class="btn" onclick="openImport()">${ico("restore")}${T("im.btn")}</button>
    <button class="btn" onclick="importPack()">${ico("upload")}${T("lib.import")}</button>
    <button class="btn brand" onclick="openCreate()">${ico("plus")}${T("nav.new")}</button></div>
    <p style="color:var(--muted);margin:6px 0 18px">${T("lib.drop_hint")}</p>
    ${S.instances.length ? `${libTools()}<div id="libGrid">${libGrid()}</div>` : emptyLib()}
    ${setsSection()}`;
}
async function importPack() { await call("import_pack", null); }

/* ---------- instance page ---------- */
function pageInstance(i) {
  const main = i.status === "ready"
    ? (i.running ? `<button class="btn red big" onclick='stop(${jsArg(i.id)})'>${ico("stop")}${T("inst.stop")}</button>`
      : i.launching ? `<button class="btn big" disabled><span class="spin"></span>${T("st.launching")}</button>`
      : `<button class="btn brand big" onclick='play(${jsArg(i.id)})'>${ico("play")}${T("inst.play")}</button>`)
    : i.status === "broken" ? `<button class="btn big" onclick='repair(${jsArg(i.id)})'>${ico("wrench")}${T("inst.repair")}</button>`
    : `<button class="btn big" disabled><span class="spin"></span>${T("st.installing")}…</button>`;
  const ready = i.status === "ready";
  const n = Object.keys(i.content || {}).length;
  return `
  <div class="ihead">
    <div class="ic avedit" title="${T("av.change")}" onclick='openAvatar(${jsArg(i.id)})'>${icon(i.icon, i.name)}<div class="ov"><div>${ico("image")}${T("av.change_short")}</div></div></div>
    <div class="meta"><h1 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.name)}</h1>
      <div class="tags"><span class="tag">Minecraft ${esc(i.mc)}</span><span class="tag">${esc(loaderName(i.loader))}${i.loader_version ? " " + esc(i.loader_version) : ""}</span>
        ${i.boosted ? `<span class="badge boost">${ico("zap")}${T("boost.badge")}</span>` : ""}${statusBadge(i)}
        ${S.friend && S.friend[i.id] ? `<span class="badge ok" style="cursor:pointer" onclick='friendModal(${jsArg(i.id)})'>${ico("users")}${T("fr.open")}</span>` : ""}</div>
      <div class="stats-line">
        <span>${ico("clock")}${T("stats.played")} <b>${esc(fmtTime(i.playtime))}</b></span>
        <span>${ico("play")}${T("stats.sessions")} <b>${i.sessions || 0}</b></span>
        <span>${ico("restore")}${T("stats.last")} <b>${esc(fmtAgo(i.last_played))}</b></span>
        <span>${ico("download")}${T("stats.mods")} <b>${n}</b></span>
      </div></div>
    <div class="acts">${main}
      <button class="btn gold big" ${ready ? "" : "disabled"} title="${T("boost.tip")}" onclick='openBoost(${jsArg(i.id)})'>${ico("rocket")}${T("boost.btn")}</button>
      ${moreBtn(i.id)}</div>
  </div>
  <div class="tabs itabs">${[["content", "inst.tab_content"], ["worlds", "inst.tab_worlds"], ["shots", "inst.tab_shots"], ["stats", "inst.tab_stats"], ["backups", "inst.tab_backups"], ["settings", "inst.tab_settings"]]
    .map(([k, l]) => `<button class="tab ${S.itab === k ? "on" : ""}" onclick="S.itab='${k}';render()">${T(l)}${k === "content" && (i.updates || []).length ? ` <span class="dotn">${i.updates.length}</span>` : ""}</button>`).join("")}
  </div>
  <div id="tab"><div class="skel"></div></div>`;
}
function loadTab() { ({backups: loadBackups, worlds: loadWorlds, shots: loadShots, stats: loadStatsTab, settings: renderInstSettings}[S.itab] || loadContent)(); }

async function loadContent() {
  const id = S.current;
  try { S.content = await call("get_content", id); } catch { S.content = []; }
  if (S.page === "instance" && S.current === id && S.itab === "content") { renderContent(); loadSuggestions(id); }
}
function renderContent() {
  const el = $("#tab"); if (!el) return;
  const i = S.instances.find(x => x.id === S.current);
  const addType = i && i.loader === "vanilla" ? "resourcepack" : "mod";
  const q = ($("#cFilter")?.value || "").toLowerCase();
  if (!S.content.length) {
    el.innerHTML = `<div class="empty"><b>${T("cont.empty")}</b>${T("cont.empty_sub")}<br><br><button class="btn brand" onclick='openBrowse(${jsArg(addType)},${jsArg(S.current)})'>${ico("compass")}${T("home.open_browse")}</button></div>`;
    return;
  }
  const items = contentView();
  S.csel = new Set([...S.csel].filter(r => S.content.some(c => c.rel === r)));
  const allOn = items.length && items.every(c => S.csel.has(c.rel));
  const hadFocus = document.activeElement && document.activeElement.id === "cFilter";
  const ups = (i && i.updates) || [], upMap = Object.fromEntries(ups.map(u => [u.rel, u]));
  const banner = ups.length
    ? `<div class="target">${ico("download")}${T("upd.available", {n: ups.length})}<span class="spacer"></span><button class="btn brand" onclick="updateContent(null)">${ico("refresh")}${T("upd.all")}</button></div>`
    : (i && i.updates_checked ? `<p class="upd-ok">${ico("check")}${T("upd.none", {when: fmtAgo(i.updates_checked)})}</p>` : "");
  el.innerHTML = `<div class="sectionbar">
      <div class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="cFilter" placeholder="${T("cont.search")}" value="${esc(q)}" oninput="renderContent()"></div>
      <button class="btn icon" title="${T("set2.from_inst")}" onclick='newSet(${jsArg(S.current)})'>${ico("layers")}</button>
      <button class="btn" ${S.checking ? "disabled" : ""} onclick="checkUpdates()">${S.checking ? '<span class="spin"></span>' : ico("refresh")}${T("upd.check")}</button>
      <button class="btn brand" onclick='openBrowse(${jsArg(addType)},${jsArg(S.current)})'>${ico("plus")}${T("cont.add")}</button></div>
    ${banner}${contentChips()}${bulkBar(items)}
    <div class="table sel"><div class="row head"><span class="cb ${allOn ? "on" : ""}" title="${T("bulk.all", {n: items.length})}" onclick="selAll(${allOn ? "false" : "true"})">${ico("check")}</span><span></span><span>${T("cont.name")}</span><span>${T("cont.type")}</span><span>${T("cont.on")}</span><span></span></div>
    ${items.length ? "" : `<div class="row"><span></span><span></span><small>${T("br.nothing")}</small></div>`}
    ${items.map(c => `<div class="row ${c.enabled ? "" : "off"} ${S.csel.has(c.rel) ? "picked" : ""}" data-rel="${esc(c.rel)}">
      <span class="cb ${S.csel.has(c.rel) ? "on" : ""}" onclick='selC(${jsArg(c.rel)},event)'>${ico("check")}</span>
      <div class="ic">${icon(c.icon, c.title)}</div>
      <div style="min-width:0"><b>${esc(c.title)}${upMap[c.rel] ? ` <button class="upd" title="${T("upd.one")}" onclick='updateContent([${jsArg(c.rel)}])'>${ico("download")}${esc(upMap[c.rel].from)} → ${esc(upMap[c.rel].to)}</button>` : ""}</b><small>${esc(c.version ? c.version + " · " : "")}${esc(c.file)}</small></div>
      <span class="tag" style="width:max-content">${T("type1." + c.type)}</span>
      <button class="switch ${c.enabled ? "on" : ""}" onclick='toggleC(${jsArg(c.rel)})'></button>
      <button class="btn icon ghost" title="${T("inst.delete")}" onclick='removeC(${jsArg(c.rel)})'>${ico("trash")}</button>
    </div>`).join("")}</div><div id="sugBox">${$("#sugBox") ? $("#sugBox").innerHTML : ""}</div>`;
  if (hadFocus) { const f = $("#cFilter"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}
async function checkUpdates() {
  const id = S.current; S.checking = true; renderContent();
  try {
    const r = await call("check_updates", id);
    const i = S.instances.find(x => x.id === id); if (i) { i.updates = r; i.updates_checked = Date.now() / 1000; }
    toast(r.length ? t("upd.found", {n: r.length}) : t("upd.none_short"), "ok");
  } catch {}
  S.checking = false;
  if (S.page === "instance" && S.current === id) { render(); }
}
async function updateContent(rels) { await call("update_content", S.current, rels); }
async function toggleC(rel) { await call("toggle_content", S.current, rel); loadContent(); }

/* worlds tab */
const MODES = ["w.survival", "w.creative", "w.adventure", "w.spectator"];
async function loadWorlds() {
  const id = S.current;
  try { S.worlds = await call("list_worlds", id); } catch { S.worlds = []; }
  if (S.page === "instance" && S.current === id && S.itab === "worlds") renderWorlds();
}
function renderWorlds() {
  const el = $("#tab"); if (!el) return;
  el.innerHTML = `<div class="sectionbar"><p>${T("w.sub")}</p>
      <button class="btn" onclick='call("open_folder",${jsArg(S.current)},"saves")'>${ico("folder")}${T("inst.folder")}</button></div>
    ${S.worlds.length ? `<div class="wgrid">${S.worlds.map(w => `<div class="world">
        <div class="wic">${w.icon ? `<img src="${safeUrl(mediaUrl(S.current, "world", w.folder))}" alt="">` : icon(null, w.name)}</div>
        <div class="winfo"><b>${esc(w.name)}</b>
          <div class="tags">${w.hardcore ? `<span class="tag" style="color:var(--red)">${T("w.hardcore")}</span>` : `<span class="tag">${T(MODES[w.mode] || "w.survival")}</span>`}</div>
          <small>${ico("clock")}${esc(fmtAgo(w.last))} · ${esc(fmtSize(w.size))}</small></div>
        <div class="wacts">
          <button class="btn icon" title="${T("inst.folder")}" onclick='call("open_folder",${jsArg(S.current)},${jsArg("saves/" + w.folder)})'>${ico("folder")}</button>
          <button class="btn icon" title="${T("w.copy")}" onclick='copyWorld(${jsArg(w.folder)},${jsArg(w.name)})'>${ico("share")}</button>
          <button class="btn icon" title="${T("inst.delete")}" onclick='deleteWorld(${jsArg(w.folder)},${jsArg(w.name)})'>${ico("trash")}</button></div>
      </div>`).join("")}</div>` : `<div class="empty"><b>${T("w.empty")}</b>${T("w.empty_sub")}</div>`}`;
}
function copyWorld(folder, name) {
  const targets = S.instances.filter(i => i.id !== S.current && i.status === "ready");
  modal(`<h3>${T("w.copy_to", {name})}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    ${targets.length ? targets.map(i => `<div class="pick" onclick='closeModal();call("copy_world",S.current,${jsArg(folder)},${jsArg(i.id)})'>
      <div class="ic">${icon(i.icon, i.name)}</div><div><b>${esc(i.name)}</b><br><small>${esc(loaderName(i.loader))} ${esc(i.mc)}</small></div></div>`).join("")
      : `<div class="empty"><b>${T("w.no_targets")}</b></div>`}`);
}
function deleteWorld(folder, name) {
  modal(`<h3>${T("w.delete_q")}</h3><p>${T("w.delete_text", {name})}</p>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button><button class="btn red" onclick='doDeleteWorld(${jsArg(folder)})'>${ico("trash")}${T("inst.delete")}</button></div>`);
}
async function doDeleteWorld(folder) { closeModal(); await call("delete_world", S.current, folder); toast(t("w.deleted"), "ok"); loadWorlds(); }

/* screenshots tab */
async function loadShots() {
  const id = S.current;
  try { S.shots = await call("list_screenshots", id); } catch { S.shots = []; }
  if (S.page === "instance" && S.current === id && S.itab === "shots") renderShots();
}
function renderShots() {
  const el = $("#tab"); if (!el) return;
  el.innerHTML = `<div class="sectionbar"><p>${T("sh.sub", {n: S.shots.length})}</p>
      <button class="btn" onclick='call("open_folder",${jsArg(S.current)},"screenshots")'>${ico("folder")}${T("inst.folder")}</button></div>
    ${S.shots.length ? `<div class="shotgrid">${S.shots.map((x, n) => `<div class="shot" onclick="openShot(${n})">
        <img src="${safeUrl(mediaUrl(S.current, "shot", x.name))}" loading="lazy" alt=""><span>${esc(fmtDate(x.time))}</span></div>`).join("")}</div>`
      : `<div class="empty"><b>${T("sh.empty")}</b>${T("sh.empty_sub")}</div>`}`;
}
let shotIdx = -1;
function openShot(n) {
  shotIdx = (n + S.shots.length) % S.shots.length;
  const x = S.shots[shotIdx], url = mediaUrl(S.current, "shot", x.name);
  modal(`<div class="lightbox"><img src="${safeUrl(url)}" alt="">
      ${S.shots.length > 1 ? `<button class="lb prev" onclick="openShot(shotIdx-1)">‹</button><button class="lb next" onclick="openShot(shotIdx+1)">›</button>` : ""}</div>
    <div class="foot" style="align-items:center"><small style="margin-right:auto">${esc(fmtDate(x.time))} · ${esc(fmtSize(x.size))} · ${shotIdx + 1}/${S.shots.length}</small>
      <button class="btn" onclick='copyShot(${jsArg(url)})'>${ico("file")}${T("sh.copy")}</button>
      <button class="btn" onclick='call("open_folder",S.current,"screenshots")'>${ico("folder")}</button>
      <button class="btn red" onclick='deleteShot(${jsArg(x.name)})'>${ico("trash")}</button>
      <button class="btn brand" onclick="closeModal()">${T("btn.close")}</button></div>`, true);
}
document.addEventListener("keydown", e => {
  if (!$(".lightbox") || !$("#modal").classList.contains("open")) return;
  if (e.key === "ArrowLeft") openShot(shotIdx - 1);
  if (e.key === "ArrowRight") openShot(shotIdx + 1);
});
async function copyShot(url) {
  try {
    const img = new Image(); img.crossOrigin = "anonymous"; img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
    toast(t("sh.copied"), "ok");
  } catch { toast(t("sh.copy_fail"), "error"); }
}
async function deleteShot(name) {
  await call("delete_screenshot", S.current, name);
  S.shots = S.shots.filter(x => x.name !== name);
  if (S.shots.length) openShot(Math.min(shotIdx, S.shots.length - 1)); else closeModal();
  renderShots();
}

/* backups tab */
async function loadBackups() {
  const id = S.current;
  try { S.backups = await call("list_backups", id); } catch { S.backups = []; }
  if (S.page === "instance" && S.current === id && S.itab === "backups") renderBackups();
}
function renderBackups() {
  const el = $("#tab"); if (!el) return;
  const reasons = {manual: t("bk.manual"), auto: t("bk.auto"), "before-restore": t("bk.before_restore"), "before-update": t("bk.before_update"), "deleted-world": t("bk.deleted_world")};
  el.innerHTML = `<div class="sectionbar"><p>${S.settings.auto_backup ? T("bk.auto_on", {n: S.settings.backups_keep}) : T("bk.auto_off")}</p>
      <button class="btn" onclick='call("open_folder",${jsArg(S.current)},"backups")'>${ico("folder")}${T("inst.folder")}</button>
      <button class="btn brand" onclick='backupNow(${jsArg(S.current)})'>${ico("archive")}${T("bk.now")}</button></div>
    ${S.backups.length ? `<div class="table">${S.backups.map(b => `<div class="brow">
        <div class="bi">${ico("archive")}</div>
        <div><b>${esc(fmtDate(b.time))}</b><small>${esc(reasons[b.reason] || b.reason)} · ${esc(fmtSize(b.size))}</small></div>
        <button class="btn" onclick='confirmRestore(${jsArg(b.name)},${jsArg(fmtDate(b.time))})'>${ico("restore")}${T("bk.restore")}</button>
        <button class="btn icon ghost" title="${T("inst.delete")}" onclick='deleteBackup(${jsArg(b.name)})'>${ico("trash")}</button></div>`).join("")}</div>`
      : `<div class="empty"><b>${T("bk.empty")}</b>${T("bk.empty_sub")}</div>`}`;
}
async function backupNow(id) { await call("backup_now", id); }
function confirmRestore(name, when) {
  modal(`<h3>${T("bk.restore_q")}</h3><p>${T("bk.restore_text", {date: when})}</p>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button><button class="btn brand" onclick='closeModal();call("restore_backup",S.current,${jsArg(name)})'>${ico("restore")}${T("bk.restore")}</button></div>`);
}
async function deleteBackup(name) { await call("delete_backup", S.current, name); loadBackups(); }

function confirmDelete(id) {
  const i = S.instances.find(x => x.id === id);
  modal(`<h3>${T("del.q")}</h3><p>${T("del.text", {name: i.name})}</p>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button><button class="btn red" onclick='doDelete(${jsArg(id)})'>${ico("trash")}${T("inst.delete")}</button></div>`);
}
async function doDelete(id) { closeModal(); await call("delete_instance", id); go("library"); toast(t("del.done")); }
async function repair(id) { await call("repair_instance", id); }
async function stop(id) { await call("stop", id); }

/* ---------- boost ---------- */
function openBoost(id) {
  const i = S.instances.find(x => x.id === id);
  const modded = i.loader !== "vanilla";
  modal(`<div class="doc-head"><div class="di" style="background:linear-gradient(135deg,#facc15,#f97316);color:#2a1603">${ico("rocket")}</div>
      <div><h3 style="margin:0">${T("boost.title")}</h3><small>${esc(i.name)} · ${esc(loaderName(i.loader))} ${esc(i.mc)}</small></div></div>
    <p>${T(modded ? "boost.text" : "boost.text_vanilla")}</p>
    <div style="margin-top:14px">
      ${modded ? `<div class="doc-item ok"><div class="di">${ico("download")}</div><p>${T("boost.p_mods")}</p></div>` : ""}
      <div class="doc-item ok"><div class="di">${ico("zap")}</div><p>${T("boost.p_jvm")}</p></div>
      <div class="doc-item ok"><div class="di">${ico("sliders")}</div><p>${T("boost.p_ram", {gb: (Math.max(S.settings.ram, S.sys.ram_recommended || 0) / 1024).toFixed(1)})}</p></div>
    </div>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button>
      <button class="btn gold" onclick='closeModal();call("boost",${jsArg(id)})'>${ico("rocket")}${T("boost.go")}</button></div>`);
}

/* ---------- doctor ---------- */
async function openDoctor(id, crashed) {
  modal(`<div class="skel" style="height:220px"></div>`, true);
  let d; try { d = await call("diagnose", id); } catch { return closeModal(); }
  const actLabel = {install: "doc.a_install", disable: "doc.a_disable", ram: "doc.a_ram", java_auto: "doc.a_java", content: "doc.a_content"};
  const items = d.findings.length ? d.findings.map((f, n) => `
    <div class="doc-item"><div class="di">${ico("alert")}</div><p>${T(f.key, f.params)}</p>
      ${f.action ? `<button class="btn brand" id="fix${n}" onclick='doctorFix(${jsArg(id)},${jsArg(f.action)},${n})'>${ico("wrench")}${T(actLabel[f.action.type])}</button>` : ""}</div>`).join("")
    : `<div class="doc-item ok"><div class="di">${ico("check")}</div><p>${T(d.has_log ? "doc.none" : "doc.no_log")}</p></div>`;
  modal(`<div class="doc-head"><div class="di">${ico("steth")}</div><div><h3 style="margin:0">${T(crashed ? "doc.crashed" : "doc.title")}</h3><small>${T("doc.sub")}</small></div>
      <button class="btn icon ghost" style="margin-left:auto" onclick="closeModal()">${ico("x")}</button></div>
    ${items}
    ${d.tail ? `<details ${d.findings.length ? "" : "open"}><summary>${T("doc.log")}</summary><div class="logtail">${esc(d.tail)}</div></details>` : ""}
    <div class="foot">${d.has_log ? `<button class="btn" onclick='call("open_log",${jsArg(id)})'>${ico("file")}${T("doc.open_log")}</button>` : ""}
      <button class="btn brand" onclick="closeModal()">${T("btn.ok")}</button></div>`, true);
}
async function doctorFix(id, action, n) {
  if (action.type === "content") { closeModal(); S.itab = "content"; return go("instance", id); }
  S.settings = await call("doctor_fix", id, action);
  const b = $("#fix" + n); if (b) { b.disabled = true; b.innerHTML = ico("check") + T("doc.fixed"); }
}

/* ---------- share ---------- */
async function shareInst(id) {
  const r = await call("export_instance", id);
  if (r) toast(t("share.saving"), "ok");
}

/* ---------- servers ---------- */
function pageServers() {
  return `<div style="display:flex;align-items:center;gap:10px"><h1>${T("srv.title")}</h1><span class="spacer"></span>
      ${S.servers.length ? `<button class="btn" onclick="pingAll(true)">${ico("refresh")}${T("srv.refresh")}</button>` : ""}
      <button class="btn" onclick="joinByAddress()">${ico("users")}${T("fr.join_title")}</button>
      <button class="btn brand" onclick="openServer()">${ico("plus")}${T("srv.add")}</button></div>
    <p style="color:var(--muted);margin:6px 0 22px">${T("srv.sub")}</p>
    ${S.servers.length ? `<div class="sgrid">${S.servers.map(serverCard).join("")}</div>`
      : `<div class="empty"><b>${T("srv.empty")}</b>${T("srv.empty_sub")}<br><br><button class="btn brand" onclick="openServer()">${ico("plus")}${T("srv.add")}</button></div>`}`;
}
function serverCard(s) {
  const p = S.pings[s.id];
  const inst = S.instances.find(i => i.id === s.instance);
  let meta, cls = "off";
  if (!p) meta = `<span><span class="spin"></span>${T("srv.pinging")}</span>`;
  else if (!p.online) meta = `<span class="ping off">● ${T("srv.offline")}</span>`;
  else {
    cls = p.ping < 80 ? "good" : p.ping < 180 ? "mid" : "bad";
    meta = `<span class="ping ${cls}">${ico("signal")}${p.ping} ms</span><span>${ico("users")}<b style="color:var(--contrast)">${p.players}</b>/${p.max}</span><span class="ver" title="${esc(p.version)}">${esc(p.version)}</span>`;
  }
  return `<div class="srv">
    <div class="fav">${p && p.favicon ? `<img src="${safeUrl(p.favicon)}" alt="">` : icon(null, s.name)}</div>
    <div style="min-width:0"><div class="top"><b>${esc(s.name)}</b>
        <button class="btn icon ghost" style="height:30px;width:30px" title="${T("srv.edit")}" onclick='openServer(${jsArg(s.id)})'>${ico("edit")}</button></div>
      <div class="addr">${esc(mask(s.address))}</div>
      <div class="motd">${p && p.motd ? esc(p.motd) : ""}</div>
      <div class="meta">${meta}</div></div>
    <div class="acts"><button class="btn brand" onclick='joinServer(${jsArg(s.id)})'>${ico("play")}${inst ? T("srv.join_in", {name: inst.name}) : T("srv.join")}</button>
      <button class="btn icon" title="${T("srv.refresh")}" onclick='pingOne(${jsArg(s.id)},true)'>${ico("refresh")}</button></div>
  </div>`;
}
const pinging = new Set();
function pingOne(id, force) {
  const s = S.servers.find(x => x.id === id);
  if (!s || pinging.has(id)) return;
  pinging.add(id);
  if (force) { delete S.pings[id]; if (S.page === "servers") render(); }
  window.pywebview.api.ping_server(s.address)
    .then(r => { S.pings[id] = r.ok ? r.data : {online: false}; })
    .catch(() => { S.pings[id] = {online: false}; })
    .finally(() => { pinging.delete(id); if (S.page === "servers" && !$("#modal").classList.contains("open")) render(); });
}
function pingAll(force) {
  S.servers.forEach(s => { if (force || !(s.id in S.pings)) pingOne(s.id, force); });
}
function openServer(id) {
  const s = S.servers.find(x => x.id === id) || {name: "", address: "", instance: ""};
  const ready = S.instances.filter(i => i.status === "ready");
  modal(`<h3>${T(id ? "srv.edit" : "srv.add")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <div class="field"><label>${T("srv.name")}</label><input class="input" id="sName" value="${esc(s.name)}" placeholder="${T("srv.name_ph")}" maxlength="40"></div>
    <div class="field"><label>${T("srv.address")}</label><input class="input" id="sAddr" type="${streamer() ? "password" : "text"}" value="${esc(s.address)}" placeholder="play.example.com"></div>
    <div class="field"><label>${T("srv.instance")}</label><p>${T("srv.instance_sub")}</p>
      <select class="input" id="sInst"><option value="">${T("srv.ask")}</option>${ready.map(i => `<option value="${esc(i.id)}" ${i.id === s.instance ? "selected" : ""}>${esc(i.name)} · ${esc(i.mc)}</option>`).join("")}</select></div>
    <div class="foot">${id ? `<button class="btn red" style="margin-right:auto" onclick='removeServer(${jsArg(id)})'>${ico("trash")}${T("inst.delete")}</button>` : ""}
      <button class="btn" onclick="closeModal()">${T("btn.cancel")}</button>
      <button class="btn brand" onclick='saveServer(${jsArg(id || null)})'>${ico("check")}${T("btn.save")}</button></div>`);
  setTimeout(() => $("#sName")?.focus(), 50);
}
async function saveServer(id) {
  S.servers = await call("save_server", {id, name: $("#sName").value, address: $("#sAddr").value, instance: $("#sInst").value});
  closeModal(); if (id) delete S.pings[id]; render();
}
async function removeServer(id) { S.servers = await call("remove_server", id); delete S.pings[id]; closeModal(); render(); }
function joinServer(id) {
  const s = S.servers.find(x => x.id === id);
  const inst = S.instances.find(i => i.id === s.instance && i.status === "ready");
  if (inst) return play(inst.id, s.address);
  const ready = S.instances.filter(i => i.status === "ready");
  modal(`<h3>${T("srv.which")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    ${ready.length ? ready.map(i => `<div class="pick" onclick='closeModal();play(${jsArg(i.id)},${jsArg(s.address)})'>
      <div class="ic">${icon(i.icon, i.name)}</div><div><b>${esc(i.name)}</b><br><small>${esc(loaderName(i.loader))} ${esc(i.mc)}</small></div></div>`).join("")
      : `<div class="empty"><b>${T("lib.empty")}</b><br><button class="btn brand" onclick="openCreate()">${ico("plus")}${T("lib.create")}</button></div>`}`);
}

/* ---------- browse ---------- */
function setTarget(id) {
  const b = S.browse; b.target = id || "";
  const i = S.instances.find(x => x.id === id);
  if (i) { b.version = i.mc; b.loader = i.loader === "vanilla" ? "" : i.loader; }
}
function clearTarget() { setTarget(""); S.browse.version = ""; S.browse.loader = ""; S.browse.hits = null; render(); }
function pageBrowse() {
  const b = S.browse, tgt = S.instances.find(i => i.id === b.target);
  const types = tgt ? (tgt.loader === "vanilla" ? ["resourcepack"] : ["mod", "resourcepack", "shader"]) : TYPES;
  if (!types.includes(b.type)) b.type = types[0];
  const opt = (v, txt, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(txt)}</option>`;
  return `
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div class="tabs" style="margin:0;flex:1">${types.map(x => `<button class="tab ${x === b.type ? "on" : ""}" onclick='S.browse.type=${jsArg(x)};S.browse.offset=0;S.browse.hits=null;render()'>${T("type." + x)}</button>`).join("")}</div>${b.type === "modpack" ? "" : targetSelect()}</div>
  <div class="toolbar">
    <div class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="q" placeholder="${T("br.search", {what: t("type." + b.type).toLowerCase()})}" value="${esc(b.query)}"></div>
    <select class="input" onchange="S.browse.sort=this.value;S.browse.offset=0;doSearch()">${SORTS.map(k => opt(k, t("sort." + k), b.sort)).join("")}</select>
    <select class="input" ${tgt ? "disabled" : ""} onchange="S.browse.version=this.value;S.browse.offset=0;doSearch()">${opt("", t("br.all_versions"), b.version)}${S.versions.map(v => opt(v, v, b.version)).join("")}</select>
    ${b.type === "mod" || b.type === "modpack" ? `<select class="input" ${tgt ? "disabled" : ""} onchange="S.browse.loader=this.value;S.browse.offset=0;doSearch()">${opt("", t("br.any_loader"), b.loader)}${LOADERS.slice(1).map(l => opt(l, loaderName(l), b.loader)).join("")}</select>` : ""}
  </div>
  <div id="results" class="list"></div><div id="pager" class="pager"></div>`;
}
let searchTimer;
document.addEventListener("input", e => {
  if (e.target.id !== "q") return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.browse.query = e.target.value; S.browse.offset = 0; doSearch(); }, 300);
});
async function doSearch() {
  const b = S.browse, el = $("#results");
  if (el) el.innerHTML = Array(4).fill('<div class="skel"></div>').join("");
  const req = {type: b.type, query: b.query, sort: b.sort, version: b.version, loader: b.loader, offset: b.offset};
  const key = JSON.stringify(req); b.key = key;
  try {
    const r = await call("search", req);
    if (b.key !== key) return;
    b.hits = r.hits; b.total = r.total;
  } catch { b.hits = []; b.total = 0; }
  renderResults();
}
function installedIds() {
  const i = S.instances.find(x => x.id === S.browse.target);
  return new Set(i ? Object.values(i.content || {}).map(c => c.project_id) : []);
}
function renderResults() {
  const b = S.browse, el = $("#results"); if (!el || !b.hits) return;
  const have = installedIds();
  if (!b.hits.length) { el.innerHTML = `<div class="empty"><b>${T("br.nothing")}</b>${T("br.nothing_sub")}</div>`; $("#pager").innerHTML = ""; return; }
  el.innerHTML = b.hits.map(h => `<div class="card" onclick='openProject(${jsArg(h.project_id)},${jsArg(b.type)})'>
      <div class="ic">${icon(h.icon_url, h.title)}</div>
      <div style="min-width:0">
        <div class="ttl"><b>${esc(h.title)}</b><span>${T("br.by", {author: h.author})}</span></div>
        <p>${esc(h.description)}</p>
        <div class="tags">${(h.display_categories || h.categories || []).slice(0, 5).map(c => `<span class="tag">${esc(c)}</span>`).join("")}</div>
      </div>
      <div class="stats">
        <div><div class="stat">${ico("download")}<b>${fmt(h.downloads)}</b></div><div class="stat" style="margin-top:4px">${ico("heart")}<b>${fmt(h.follows)}</b></div></div>
        ${have.has(h.project_id) ? `<button class="btn" disabled>${ico("check")}${T("br.installed")}</button>`
          : `<button class="btn brand" onclick='event.stopPropagation();install(${jsArg(h.project_id)},${jsArg(b.type)},${jsArg(h.title)})'>${ico("download")}${T("br.install")}</button>`}
      </div></div>`).join("");
  const pages = Math.ceil(Math.min(b.total, 10000) / 20), cur = b.offset / 20 + 1;
  $("#pager").innerHTML = pages > 1 ? `<button class="btn" ${cur <= 1 ? "disabled" : ""} onclick="page(-1)">← ${T("br.prev")}</button><span>${T("br.page", {cur, pages})}</span><button class="btn" ${cur >= pages ? "disabled" : ""} onclick="page(1)">${T("br.next")} →</button>` : "";
}
function page(d) { S.browse.offset = Math.max(0, S.browse.offset + d * 20); doSearch(); $("#main").scrollTop = 0; }

async function install(pid, type, title) {
  if (type === "modpack") return pickPackVersion(pid, title);
  if (S.browse.target && S.page === "browse") return call("install_project", pid, type, S.browse.target);
  const ok = S.instances.filter(i => i.status === "ready" && (type !== "mod" || i.loader !== "vanilla"));
  modal(`<h3>${T("br.where", {name: title})}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    ${ok.length ? ok.map(i => `<div class="pick" onclick='closeModal();call("install_project",${jsArg(pid)},${jsArg(type)},${jsArg(i.id)})'>
      <div class="ic">${icon(i.icon, i.name)}</div><div><b>${esc(i.name)}</b><br><small>${esc(loaderName(i.loader))} ${esc(i.mc)}</small></div></div>`).join("")
      : `<div class="empty"><b>${T("br.no_fit")}</b>${type === "mod" ? T("br.no_fit_mod") : ""}<br><br><button class="btn brand" onclick="openCreate()">${ico("plus")}${T("lib.create")}</button></div>`}`);
}
async function openProject(pid, type) {
  modal(`<div class="skel" style="height:300px"></div>`, true);
  let p; try { p = await call("get_project", pid); } catch { return closeModal(); }
  const imgs = (p.gallery || []).map(g => safeUrl(g.url)).filter(Boolean);
  const gv = p.game_versions || [];
  modal(`<h3><span style="display:flex;gap:14px;align-items:center;min-width:0"><span class="ic" style="width:64px;height:64px;border-radius:14px;overflow:hidden;flex:none">${icon(p.icon_url, p.title)}</span>
      <span style="min-width:0">${esc(p.title)}<br><small style="font-size:13px;font-weight:500;color:var(--muted)">${esc(p.description)}</small></span></span>
      <button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <div class="tags">${(p.categories || []).map(c => `<span class="tag">${esc(c)}</span>`).join("")}${(p.loaders || []).map(c => `<span class="tag" style="color:var(--brand)">${esc(c)}</span>`).join("")}</div>
    ${imgs.length ? `<div class="gallery">${imgs.map(u => `<img src="${u}" loading="lazy" alt="">`).join("")}</div>` : `<div style="height:16px"></div>`}
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      <div class="stat">${ico("download")}<b>${fmt(p.downloads)}</b> ${T("pr.downloads")}</div>
      <div class="stat">${ico("heart")}<b>${fmt(p.followers)}</b> ${T("pr.followers")}</div>
      <div class="stat">${T("pr.versions")} <b>${esc(gv[0] || "—")}</b> … <b>${esc(gv[gv.length - 1] || "—")}</b></div>
    </div>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.close")}</button>
      ${["mod", "resourcepack", "shader"].includes(p.project_type || type) ? `<button class="btn" onclick='addToSetPick(${jsArg({project_id: p.id, title: p.title, icon: p.icon_url, type: p.project_type || type})})'>${ico("layers")}${T("set2.add_btn")}</button>` : ""}
      <button class="btn brand" onclick='closeModal();install(${jsArg(p.id)},${jsArg(p.project_type || type)},${jsArg(p.title)})'>${ico("download")}${T("br.install")}</button></div>`, true);
}

/* ---------- avatars ---------- */
function openAvatar(id) {
  const i = S.instances.find(x => x.id === id); if (!i) return;
  modal(`<h3>${T("av.title")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <div class="avbig">${icon(i.icon, i.name)}</div>
    <p style="text-align:center">${T("av.hint")}</p>
    <div class="foot" style="justify-content:center">
      ${i.icon_file ? `<button class="btn" onclick='setAvatar(${jsArg(id)},null)'>${ico("trash")}${T("av.remove")}</button>` : ""}
      <button class="btn brand" onclick='chooseAvatar(${jsArg(id)})'>${ico("image")}${T("av.choose")}</button></div>`);
}
async function chooseAvatar(id) { const r = await call("pick_image"); if (r) await setAvatar(id, r.path); }
async function setAvatar(id, path) {
  await call("set_icon", id, path); closeModal();
  if (S.page === "instance") render();
  toast(t(path ? "av.updated" : "av.removed"), "ok");
}

/* ---------- create instance ---------- */
let newLoader = "fabric", newIcon = null, newTpl = "";
function setNewTpl(k) {
  newTpl = k; document.querySelectorAll("#nTpl button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
  $("#nLoaderField").style.display = k ? "none" : "";
}
function newIconHtml() {
  return newIcon ? `<div class="genicon"><img src="${safeUrl(newIcon.preview)}" alt=""></div>`
    : `<div class="genicon" style="background:var(--raised);color:var(--muted)"><div style="text-align:center;font-size:12px;font-weight:600">${ico("image")}<br>${T("av.short")}</div></div>`;
}
async function pickNewIcon() { const r = await call("pick_image"); if (r) { newIcon = r; $("#nIcon").innerHTML = newIconHtml(); } }
function setNewLoader(l) { newLoader = l; document.querySelectorAll("#nLoader button").forEach(b => b.classList.toggle("on", b.dataset.l === l)); }
function openCreate() {
  newLoader = "fabric"; newIcon = null; newTpl = "";
  const vs = S.versions.length ? S.versions : [t("cr.loading")];
  modal(`<h3>${T("nav.new")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <div class="field" style="display:flex;gap:16px;align-items:center">
      <div class="newav avedit" id="nIcon" title="${T("av.choose")}" onclick="pickNewIcon()">${newIconHtml()}</div>
      <div style="flex:1"><label>${T("cr.name")}</label><input class="input" id="nName" placeholder="${T("cr.name_ph")}" maxlength="40" style="width:100%;margin-top:4px"></div></div>
    <div class="field"><label>${T("cr.start")}</label>
      <div class="seg" id="nTpl" style="grid-template-columns:repeat(3,1fr)">${[["", "cr.empty"], ["fps", "tpl.fps"], ["shaders", "tpl.shaders"]].map(([k, l]) => `<button data-k="${k}" class="${k === newTpl ? "on" : ""}" style="text-transform:none" onclick="setNewTpl('${k}')">${T(l)}</button>`).join("")}</div></div>
    <div class="field" id="nLoaderField"><label>${T("cr.loader")}</label><p>${T("cr.loader_sub")}</p>
      <div class="seg" id="nLoader">${LOADERS.map(l => `<button data-l="${l}" class="${l === newLoader ? "on" : ""}" onclick="setNewLoader('${l}')">${loaderName(l)}</button>`).join("")}</div></div>
    <div class="field"><label>${T("cr.version")}</label>
      <div class="chips" id="nKind" style="margin:4px 0 8px">${VER_KINDS.map(k => `<button class="fchip ${k === verKind ? "on" : ""}" data-k="${k}" onclick="setVerKind('${k}')">${T("vk." + k)}</button>`).join("")}</div>
      <select class="input" id="nVer">${vs.map(v => `<option>${esc(v)}</option>`).join("")}</select>
      <p id="nKindNote" style="font-size:12px;color:var(--muted);margin:6px 0 0"></p></div>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button><button class="btn brand" onclick="createInst()">${ico("plus")}${T("cr.create")}</button></div>`);
  setTimeout(() => $("#nName")?.focus(), 50);
  verKind = "release";
  loadAllVersions().then(() => setVerKind("release"));
}
const VER_KINDS = ["release", "snapshot", "old_beta", "old_alpha"];
let verKind = "release";
async function loadAllVersions() {
  if (S.allVersions && S.allVersions.length) return;
  try { S.allVersions = await call("get_all_versions"); } catch { S.allVersions = []; }
}
function setVerKind(k) {
  verKind = k;
  document.querySelectorAll("#nKind .fchip").forEach(b => b.classList.toggle("on", b.dataset.k === k));
  const list = (S.allVersions || []).filter(v => v.type === k).map(v => v.id);
  const sel = $("#nVer"); if (!sel) return;
  sel.innerHTML = (list.length ? list : (k === "release" ? S.versions : [])).map(v => `<option>${esc(v)}</option>`).join("") || `<option>${T("cr.loading")}</option>`;
  const old = k === "old_beta" || k === "old_alpha";
  document.querySelectorAll("#nLoader button").forEach(b => { b.disabled = old && b.dataset.l !== "vanilla"; });
  if (old) setNewLoader("vanilla");
  $("#nKindNote").textContent = old ? t("vk.old_note") : k === "snapshot" ? t("vk.snap_note") : "";
}
async function createInst() {
  const name = $("#nName").value.trim() || t("cr.default_name", {n: S.instances.length + 1});
  const mc = $("#nVer").value;
  if (!S.versions.includes(mc) && !(S.allVersions || []).some(v => v.id === mc)) return toast(t("cr.wait_versions"), "error");
  if (verKind === "old_beta" || verKind === "old_alpha") { newTpl = ""; newLoader = "vanilla"; }
  const id = await call("create_instance", name, mc, newLoader, newIcon ? newIcon.path : null, newTpl || null);
  closeModal(); go("instance", id);
}

/* ---------- settings ---------- */
function pageSettings() {
  const s = S.settings;
  const themeCard = (id, cls, desc) => `<div class="theme ${s.theme === id || (id === "emerald" && s.theme !== "aurora") ? "on" : ""}" onclick="selectTheme('${id}')">
      <div class="tprev ${cls}"><div class="r"></div><div class="c"><div class="h"></div><div class="g"><div></div><div></div><div></div></div></div></div>
      <b>${T("theme." + id)} ${(s.theme === id || (id === "emerald" && s.theme !== "aurora")) ? ico("check") : ""}</b><small>${T(desc)}</small></div>`;
  return `<h1>${T("nav.settings")}</h1>
  ${accountPanel()}
  <div class="panel">
    <div class="field"><label>${ico("globe")} ${T("set.language")}</label><p>${T("set.language_sub")}</p>
      <div class="lang-grid">${Object.entries(LANG_NAMES).map(([k, [n, c]]) => `<button class="${s.lang === k ? "on" : ""}" onclick="selectLang('${k}')">${c}<small>${esc(n)}</small></button>`).join("")}</div></div>
    <div class="field" style="margin-bottom:0"><label>${T("set.theme")}</label><p>${T("set.theme_sub")}</p>
      <div class="themes">${themeCard("emerald", "tp-m", "theme.emerald_sub")}${themeCard("aurora", "tp-a", "theme.aurora_sub")}</div></div>
    <div class="field" style="margin:20px 0 0"><label>${T("set.navpos")}</label><p>${T("set.navpos_sub")}</p>
      <div class="seg" style="grid-template-columns:1fr 1fr;max-width:360px">${["bottom", "left"].map(k => `<button class="${(s.navpos || "bottom") === k ? "on" : ""}" style="text-transform:none" onclick="setNavPos('${k}')">${ico(k === "bottom" ? "dock-b" : "dock-l")}${T("navpos." + k)}</button>`).join("")}</div></div>
    <div class="field" style="margin:20px 0 0"><label>${T("set.accent")}</label><p>${T("set.accent_sub")}</p>
      <div class="accents">${ACCENTS.map(c => `<button class="sw ${(s.accent || "") === c ? "on" : ""} ${c ? "" : "def"}" style="--c:${c || "var(--brand0)"}" title="${c ? esc(c) : T("set.accent_default")}" onclick="selectAccent('${c}')">${c ? "" : ico("restore")}</button>`).join("")}
        <label class="sw custom ${s.accent && !ACCENTS.includes(s.accent) ? "on" : ""}" style="--c:${esc(s.accent && !ACCENTS.includes(s.accent) ? s.accent : "#888")}" title="${T("set.accent_custom")}">${ico("edit")}<input type="color" value="${esc(s.accent || "#1bd96a")}" onchange="selectAccent(this.value)"></label></div></div>
  </div>
  ${netPanel()}
  ${typeof donatePanel === "function" ? donatePanel() : ""}
  <div class="panel">
    <div class="field"><label>${T("set.ram")}: <span id="ramV" style="color:var(--brand)">${esc(gb(s.ram))}</span></label>
      <p>${T("set.ram_sub", {total: ((S.sys.ram_total || 0) / 1024).toFixed(0), rec: ((S.sys.ram_recommended || 0) / 1024).toFixed(1)})}</p>
      <div class="row2"><input type="range" id="sRam" min="1024" max="${Math.max(4096, Math.min(32768, (S.sys.ram_total || 16384) - 1024))}" step="512" value="${s.ram}" oninput="$('#ramV').textContent=gb(this.value)" style="flex:1">
        <button class="btn" onclick="$('#sRam').value=S.sys.ram_recommended;$('#sRam').oninput()">${ico("zap")}${T("set.ram_auto")}</button></div></div>
    <div class="field"><label>${T("set.java")}</label><p>${T("set.java_sub")}</p><input class="input" id="sJava" type="${streamer() ? "password" : "text"}" value="${esc(s.java)}" placeholder="${T("set.java_ph")}"></div>
    <div class="field" style="display:flex;align-items:center;gap:14px"><button class="switch ${s.snapshots ? "on" : ""}" id="sSnap" onclick="this.classList.toggle('on')"></button><label style="margin:0">${T("set.snapshots")}</label></div>
    <div class="field" style="display:flex;align-items:center;gap:14px"><button class="switch ${s.splash !== false ? "on" : ""}" id="sSplash" onclick="this.classList.toggle('on')"></button><label style="margin:0">${T("set.splash")}</label></div>
    <div class="field" style="display:flex;align-items:center;gap:14px"><button class="switch ${s.auto_backup ? "on" : ""}" id="sAutoBk" onclick="this.classList.toggle('on')"></button>
      <div><label style="margin:0">${T("set.autobackup")}</label><p style="margin:0">${T("set.autobackup_sub")}</p></div></div>
    <div class="field" style="display:flex;align-items:center;gap:14px"><input class="input num" type="number" id="sKeep" min="1" max="30" value="${s.backups_keep}"><label style="margin:0">${T("set.keep")}</label></div>
    <div class="field" style="display:flex;align-items:center;gap:14px"><button class="switch ${streamer() ? "on" : ""}" onclick="toggleStreamer()"></button>
      <div><label style="margin:0">${T("str.title")}</label><p style="margin:0">${T("str.sub")}</p></div></div>
    <div class="field" style="display:flex;align-items:center;gap:14px"><button class="switch ${s.discord !== false && S.features.discord ? "on" : ""}" id="sDiscord" ${S.features.discord ? "" : "disabled"} onclick="toggleDiscord(this)"></button>
      <div><label style="margin:0">${T("set.discord")}</label><p style="margin:0">${T(S.features.discord ? "set.discord_sub" : "set.discord_setup")}</p></div></div>
    <button class="btn brand" onclick="saveSettings()">${ico("check")}${T("btn.save")}</button>
  </div>
  <div class="panel"><div class="field" style="margin:0;display:flex;gap:14px;align-items:center">
    <div class="si-logo"><svg class="wings" viewBox="0 0 64 64"><use href="#i-wings"/></svg></div>
    <div style="flex:1"><label style="margin:0">Elytra ${esc(S.appVersion || "")}</label>
      <p style="margin:0">${S.selfUpdate ? T("self.available", {v: S.selfUpdate.version}) : T(S.features.updates ? "self.sub" : "self.setup")}</p>
      ${S.features.exe ? "" : `<p style="margin:6px 0 0;color:#f5b84b">${ico("info")} ${T("app.from_source")}</p>`}</div>
    ${S.features.updates && !S.selfUpdate ? `<button class="btn" onclick="checkSelfUpdate()">${ico("refresh")}${T("self.check")}</button>` : ""}
    ${S.selfUpdate ? `<button class="btn brand" onclick="applySelfUpdate()">${ico("download")}${T("self.install")}</button>` : ""}
  </div></div>
  <p style="margin-top:16px;color:var(--muted)">Elytra ${esc(S.appVersion || "")} · ${T("set.credits")}</p>`;
}
function accountPanel() {
  const s = S.settings, f = S.features;
  const nickField = `<input class="input" id="sNick" type="${streamer() ? "password" : "text"}" value="${esc(s.nick)}" maxlength="16" onclick="event.stopPropagation()">`;
  if (!f.ms) return `<div class="panel"><div class="field"><label>${ico("users")} ${T("acc.title")}</label><p>${T("acc.ms_pending")}</p></div>
    <div class="field" style="margin:0"><label>${T("set.nick")}</label>${nickField}</div></div>`;
  const rows = S.accounts.map(a => `<div class="acc ${s.account === a.id ? "on" : ""}" onclick='selectAccount(${jsArg(a.id)})'>
      ${face(a.name, 40)}
      <div style="flex:1"><b>${esc(mask(a.name))}</b><small>Microsoft · ${T("acc.licensed")}</small></div>
      ${s.account === a.id ? `<span class="badge ok">${ico("check")}${T("acc.active")}</span>` : ""}
      <button class="btn icon ghost" title="${T("acc.remove")}" onclick='event.stopPropagation();removeAccount(${jsArg(a.id)})'>${ico("trash")}</button></div>`).join("");
  const offline = f.license_only ? "" : `<div class="acc ${!s.account ? "on" : ""}" onclick="selectAccount('')">
      <div class="avatar" style="display:grid;place-items:center">${ico("user")}</div>
      <div style="flex:1"><b>${T("acc.offline")}</b>${nickField}</div>${!s.account ? `<span class="badge ok">${ico("check")}${T("acc.active")}</span>` : ""}</div>`;
  return `<div class="panel"><div class="field" style="margin:0"><label>${ico("users")} ${T("acc.title")}</label>
    <p>${T(f.license_only ? "acc.license_only" : "acc.sub")}</p>
    <div class="accs">${rows}${offline}</div>
    <button class="btn brand" style="margin-top:12px" onclick="msLogin()">${ico("plus")}${T("acc.add")}</button></div></div>`;
}
async function msLogin() {
  modal(`<div class="doc-head"><div class="di"><span class="spin" style="width:22px;height:22px"></span></div><div><h3 style="margin:0">${T("acc.waiting")}</h3><small>${T("acc.waiting_sub")}</small></div></div>`);
  try {
    const r = await call("ms_login");
    Object.assign(S, {accounts: r.accounts, settings: r.settings});
    toast(t("acc.added", {name: r.name}), "ok");
  } catch {}
  closeModal(); render();
}
async function selectAccount(id) { if ((S.settings.account || "") === id) return; await saveSettingsObj({account: id, nick: $("#sNick")?.value || S.settings.nick}); render(); }
async function removeAccount(id) { const r = await call("remove_account", id); Object.assign(S, {accounts: r.accounts, settings: r.settings}); render(); }
async function checkSelfUpdate() {
  const r = await call("check_self_update");
  if (r) { S.selfUpdate = r; render(); } else toast(t("self.latest"), "ok");
}
async function applySelfUpdate() { await call("apply_self_update"); }

/* accent color */
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
function applyAccent(hex) {
  const st = document.body.style, vars = ["--brand", "--brand-bg", "--sp1", "--sp2", "--grad", "--on-brand"];
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) { vars.forEach(v => st.removeProperty(v)); document.body.classList.remove("accent"); return; }
  const [h, s, l] = hexToHsl(hex);
  const lum = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const L = .2126 * lum[0] + .7152 * lum[1] + .0722 * lum[2];
  st.setProperty("--brand", hex);
  st.setProperty("--brand-bg", `hsla(${h},${s}%,${l}%,.15)`);
  st.setProperty("--sp1", hex);
  st.setProperty("--sp2", `hsl(${(h + 40) % 360},${s}%,${Math.max(35, l - 8)}%)`);
  st.setProperty("--grad", `linear-gradient(135deg,${hex},hsl(${(h + 40) % 360},${s}%,${Math.max(40, l)}%))`);
  st.setProperty("--on-brand", L > .45 ? "#10140f" : "#fff");
  document.body.classList.add("accent");
}
async function selectAccent(c) { applyAccent(c); await saveSettingsObj({accent: c}); render(); }
function applyTheme(th) { document.body.classList.toggle("aurora", th === "aurora"); }
async function saveSettingsObj(patch) { S.settings = await call("save_settings", {...S.settings, ...patch}); }
async function selectTheme(th) { applyTheme(th); await saveSettingsObj({theme: th}); render(); }
async function selectLang(l) { await saveSettingsObj({lang: l}); applyStaticText(); render(); }
async function saveSettings() {
  const snapBefore = S.settings.snapshots;
  await saveSettingsObj({nick: $("#sNick") ? $("#sNick").value : S.settings.nick, ram: +$("#sRam").value, java: $("#sJava").value,
    discord: $("#sDiscord").classList.contains("on"),
    snapshots: $("#sSnap").classList.contains("on"), splash: $("#sSplash").classList.contains("on"),
    auto_backup: $("#sAutoBk").classList.contains("on"), backups_keep: +$("#sKeep").value || 5});
  if (snapBefore !== S.settings.snapshots) loadVersions();
  renderChrome(); toast(t("set.saved"), "ok");
}

/* ---------- modals, toasts, tasks ---------- */
function modal(html, wide) { const d = $("#dialog"); d.className = "dialog" + (wide ? " wide" : ""); d.innerHTML = html; $("#modal").classList.add("open"); }
function closeModal() { $("#modal").classList.remove("open"); }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
function toast(text, kind = "info") {
  const el = document.createElement("div");
  el.className = "task " + (kind === "error" ? "err" : kind === "ok" ? "ok" : "");
  el.innerHTML = `<b>${ico(kind === "error" ? "x" : "check")}${esc(text)}</b>`;
  $("#tasks").appendChild(el); setTimeout(() => el.remove(), kind === "error" ? 7000 : 3000);
}
function renderTask(tk) {
  let el = document.getElementById("task" + tk.id);
  if (!el) { el = document.createElement("div"); el.id = "task" + tk.id; $("#tasks").appendChild(el); }
  const pct = tk.max ? Math.min(100, tk.value / tk.max * 100) : 0;
  el.className = "task" + (tk.error ? " err" : tk.done ? " ok" : "");
  el.innerHTML = tk.done
    ? `<b>${ico(tk.error ? "x" : "check")}${esc(tm(tk.title))}</b><small style="white-space:normal">${esc(tm(tk.error || tk.message))}</small>`
    : `<b><span class="spin"></span>${esc(tm(tk.title))}</b><small>${esc(tm(tk.status) || t("task.preparing"))}</small><div class="bar ${tk.max ? "" : "indet"}"><i style="width:${pct}%"></i></div>`;
  if (tk.done) setTimeout(() => el.remove(), tk.error ? 9000 : 4500);
}

/* ---------- drag & drop overlay (the file itself is handled in Python) ---------- */
let dragDepth = 0;
const isFileDrag = e => [...(e.dataTransfer?.types || [])].includes("Files");
document.addEventListener("dragenter", e => { if (!isFileDrag(e)) return; dragDepth++; $("#drop").classList.add("on"); });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#drop").classList.remove("on"); } });
document.addEventListener("dragover", e => { if (isFileDrag(e)) e.preventDefault(); });
document.addEventListener("drop", e => {
  dragDepth = 0; $("#drop").classList.remove("on");
  const fs = [...(e.dataTransfer?.files || [])];
  const okExt = S.page === "instance" ? /\.(mrpack|jar|zip)$/i : /\.mrpack$/i;
  if (fs.length && !fs.some(f => okExt.test(f.name))) toast(t(S.page === "instance" ? "drop.wrong_inst" : "drop.wrong"), "error");
});

/* ---------- events from Python ---------- */
window.onLauncherEvent = (type, d) => {
  if (type === "task") {
    renderTask(d);
    if (d.done && S.page === "instance") { loadTab(); }
    if (d.done && S.page === "browse") renderResults();
  } else if (type === "instances") {
    S.instances = d;
    d.forEach(i => { if (!i.running && S.friend) delete S.friend[i.id]; if (!i.running && !i.launching && launchState[i.id]) closeLaunch(i.id); });
    const busy = $("#modal").classList.contains("open") || (document.activeElement && document.activeElement.tagName === "INPUT");
    if (["home", "library", "instance"].includes(S.page) && !busy) {
      if (S.page === "instance") {
        const i = S.instances.find(x => x.id === S.current);
        const head = document.querySelector(".ihead");
        if (i && head) head.outerHTML = pageInstance(i).split('<div class="tabs itabs">')[0].trim();
        else render();
      } else render();
    } else if (S.page === "browse") renderResults();
    renderChrome();
  } else if (type === "toast") toast(tm(d), d.kind);
  else if (type === "crash") { closeLaunch(d.id); openDoctor(d.id, true); }
  else if (type === "launch_stage") onLaunchStage(d);
  else if (type === "preflight") showPreflight(d.id, null, d.issues);
  else if (type === "friend_link") {
    S.friend[d.id] = d.domain; toast(t("fr.ready"), "ok");
    if (!$("#modal").classList.contains("open")) friendModal(d.id);
  } else if (type === "achievement") showAchievement(d);
  else if (type === "self_update") { S.selfUpdate = d; toast(t("self.available", {v: d.version}), "ok"); if (["home", "settings"].includes(S.page) && !$("#modal").classList.contains("open")) render(); }
  else if (type === "net") { S.net = d; drawNet(); }
  else if (type === "support") onSupport(d);
  else if (type === "friends" || type === "friend_request" || type === "friend_invite") onFriendsEvent(type, d);
  else if (type === "content_changed" && S.page === "instance" && S.current === d.id && S.itab === "content") loadContent();
};

/* ---------- splash ---------- */
let SPLASH_T0 = 0;
function startSplash() {
  const sp = $("#splash"); if (!sp || sp.classList.contains("go")) return;
  SPLASH_T0 = performance.now(); sp.classList.add("go");
  const box = $("#spDots");
  for (let i = 0; i < 26; i++) {
    const d = document.createElement("i"), sz = 2 + Math.random() * 4;
    d.className = "sp-dot";
    d.style.cssText = `left:${Math.random() * 100}%;width:${sz}px;height:${sz}px;animation-duration:${4 + Math.random() * 5}s;animation-delay:${Math.random() * 3}s;--dx:${(Math.random() - .5) * 120}px`;
    box.appendChild(d);
  }
  splashText(t("sp.starting"));
  [[700, "sp.instances"], [1500, "sp.modrinth"], [2300, "sp.almost"]].forEach(([ms, k]) => setTimeout(() => splashText(t(k)), ms));
}
setTimeout(startSplash, 1500);
function splashText(txt) { const el = $("#spSub"); if (el) el.innerHTML = `<span>${esc(txt)}</span>`; }
function hideSplash() {
  const sp = $("#splash"); if (!sp || sp.classList.contains("hide")) return;
  const fast = !sp.classList.contains("go");
  if (!fast) splashText(t("sp.ready"));
  setTimeout(() => {
    sp.classList.add("hide");
    document.body.classList.add("intro");
    document.querySelectorAll("#main .hero, #main h1, #main h2, #main .grid > *, #main .hscroll > *, #main .list > *, #main .panel, #main .ihead, #main .tabs, #main .toolbar, #main .empty, #main .statcard")
      .forEach((el, i) => { el.classList.add("rise"); el.style.animationDelay = (0.25 + Math.min(i, 14) * 0.06) + "s"; });
    setTimeout(() => { sp.remove(); document.body.classList.remove("intro"); }, 1600);
    if (S.needOnb) { S.needOnb = false; setTimeout(showOnboarding, fast ? 0 : 500); }
  }, fast ? 0 : 250);
}
setTimeout(hideSplash, 8000);

async function loadVersions() {
  try { S.versions = await call("get_versions", !!S.settings.snapshots); } catch { S.versions = []; }
  if (S.page === "browse") render();
}
async function init() {
  const d = await call("init");
  Object.assign(S, {instances: d.instances, settings: d.settings, servers: d.servers, appVersion: d.version,
    media: d.media || "", net: d.net || {}, supUnread: d.sup_unread || 0, game: d.game || {best: 0, plays: 0}, logPath: d.log || "", accounts: d.accounts || [], features: d.features || {}, sets: d.sets || [],
    sys: {ram_total: d.ram_total, ram_recommended: d.ram_recommended}});
  applyTheme(S.settings.theme); applyAccent(S.settings.accent); applyStaticText(); applyStreamer();
  S.needOnb = !S.settings.onboarded;
  go("home"); loadVersions();
  call("get_donate").then(r => { if (r) { S.donate = r; if (S.page === "settings") render(); } }).catch(() => {});
  (d.pending || []).forEach(p => p.type === "preflight" ? showPreflight(p.id, null, p.issues) : toast(tm(p), p.kind));
  if (S.settings.splash === false) return hideSplash();
  startSplash();
  setTimeout(hideSplash, Math.max(0, 3000 - (performance.now() - SPLASH_T0)));
}
/* init() is started at the end of extra.js, after every script has loaded */
