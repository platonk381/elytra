"use strict";
/* Elytra 0.5: stats, pre-launch check, onboarding, instance settings & clone, Ctrl+K palette, 3D skin viewer */

/* ---------- game statistics ---------- */
const prettyId = id => String(id).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const fmtNum = n => Math.round(n || 0).toLocaleString(S.settings.lang || "en");
const fmtKm = cm => ((cm || 0) / 100000).toFixed(1) + " " + t("u.km");
const WINGS = `<svg class="wings" viewBox="0 0 64 64"><use href="#i-wings"/></svg>`;
function statCards(st, compact) {
  const cards = [
    ["💎", fmtNum(st.diamonds), "stat.diamonds"], ["⛏️", fmtNum(st.blocks), "stat.blocks"],
    ["👣", fmtKm(st.distance), "stat.distance"], [WINGS, fmtKm(st.elytra), "stat.elytra"],
    ["⚔️", fmtNum(st.mob_kills), "stat.mob_kills"], ["💥", fmtNum(st.creepers), "stat.creepers"],
    ["💀", fmtNum(st.deaths), "stat.deaths"], ["⏱️", fmtTime(st.ticks / 20), "stat.ingame"],
    ["🦘", fmtNum(st.jumps), "stat.jumps"], ["🎣", fmtNum(st.fish), "stat.fish"],
    ["🔨", fmtNum(st.crafted), "stat.crafted"], ["🤝", fmtNum(st.trades), "stat.trades"]];
  return `<div class="stgrid">${(compact ? cards.slice(0, 6) : cards).map(([e, v, k], n) =>
    `<div class="stc" style="animation-delay:${n * 40}ms"><span class="se">${e}</span><b>${esc(v)}</b><small>${T(k)}</small></div>`).join("")}</div>`;
}
function topList(title, items, emoji) {
  if (!items || !items.length) return "";
  const max = items[0][1] || 1;
  return `<div class="panel" style="max-width:none;margin:0"><label class="stl">${emoji} ${esc(title)}</label><div class="bars">${items.map(([id, n]) => `
    <div class="barrow nb"><b>${esc(prettyId(id))}</b><div class="track"><i style="width:${Math.max(4, n / max * 100)}%"></i></div><span>${esc(fmtNum(n))}</span></div>`).join("")}</div></div>`;
}
function statsHtml(st, compact) {
  if (!st || !st.players) return `<div class="empty"><b>${T("stat.empty")}</b>${T("stat.empty_sub")}</div>`;
  let html = statCards(st, compact);
  if (!compact) {
    html += `<div class="stcols">${topList(t("stat.top_mined"), st.top_mined, "⛏️")}${topList(t("stat.top_killed"), st.top_killed, "⚔️")}</div>`;
    if (st.nemesis && st.nemesis.length) html += `<div class="nemesis">💀 ${T("stat.nemesis", {mob: prettyId(st.nemesis[0][0]), n: st.nemesis[0][1]})}</div>`;
  }
  return html;
}
async function loadHomeStats() {
  let st; try { st = await call("get_stats", null); } catch { return; }
  const el = $("#homeStats"); if (!el || !st.players) return;
  S.globalStats = st;
  el.innerHTML = `<h2>📊 ${T("stat.title")} <a onclick="openAllStats()">${T("home.see_all")} →</a></h2>${statCards(st, true)}`;
}
function openAllStats() {
  modal(`<h3>📊 ${T("stat.title")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <p style="margin:-8px 0 16px">${T("stat.all_sub", {n: S.globalStats.worlds})}</p>${statsHtml(S.globalStats, false)}`, true);
}
async function loadStatsTab() {
  const id = S.current; let st;
  try { st = await call("get_stats", id); } catch { st = null; }
  const el = $("#tab"); if (!el || S.current !== id || S.itab !== "stats") return;
  el.innerHTML = `<div class="sectionbar"><p>${T("stat.inst_sub")}</p></div>${statsHtml(st, false)}`;
}

/* ---------- pre-launch check ---------- */
const ACT_LABEL = {install: "doc.a_install", disable: "doc.a_disable", ram: "doc.a_ram", java_auto: "doc.a_java", content: "doc.a_content"};
async function play(id, server, force) {
  const r = await call("play", id, server || null, !!force);
  if (r && r.issues) return showPreflight(id, server, r.issues);
  toast(t("play.starting"), "ok");
}
function showPreflight(id, server, issues) {
  modal(`<div class="doc-head"><div class="di" style="background:rgba(255,163,71,.15);color:var(--orange)">${ico("shield")}</div>
      <div><h3 style="margin:0">${T("pre.title")}</h3><small>${T("pre.sub", {n: issues.length})}</small></div>
      <button class="btn icon ghost" style="margin-left:auto" onclick="closeModal()">${ico("x")}</button></div>
    ${issues.map((f, n) => `<div class="doc-item"><div class="di">${ico("alert")}</div><p>${T(f.key, f.params)}</p>
      ${f.action ? `<button class="btn brand" id="fix${n}" onclick='doctorFix(${jsArg(id)},${jsArg(f.action)},${n})'>${ico("wrench")}${T(ACT_LABEL[f.action.type])}</button>` : ""}</div>`).join("")}
    <div class="foot">
      <button class="btn ghost" style="margin-right:auto" onclick='closeModal();play(${jsArg(id)},${jsArg(server || null)},true)'>${T("pre.anyway")}</button>
      ${issues.some(f => f.action) ? `<button class="btn" onclick='fixAll(${jsArg(id)},${jsArg(issues)})'>${ico("wrench")}${T("pre.fix_all")}</button>` : ""}
      <button class="btn brand" onclick='closeModal();play(${jsArg(id)},${jsArg(server || null)})'>${ico("play")}${T("pre.again")}</button></div>`, true);
}
async function fixAll(id, issues) {
  for (const [n, f] of issues.entries()) if (f.action) { try { await doctorFix(id, f.action, n); } catch {} }
  toast(t("pre.fixed"), "ok");
}

/* ---------- instance settings & clone ---------- */
function renderInstSettings() {
  const el = $("#tab"); const i = S.instances.find(x => x.id === S.current); if (!el || !i) return;
  const o = i.opts || {};
  el.innerHTML = `<div class="panel" style="max-width:none;margin:0">
    <div class="field"><label>${T("is.name")}</label><input class="input" id="isName" value="${esc(i.name)}" maxlength="40"></div>
    <div class="field"><label>${T("set.ram")}</label><p>${T("is.ram_sub", {gb: gb(S.settings.ram)})}</p>
      <div class="row2"><input class="input num" type="number" id="isRam" min="1024" max="65536" step="512" placeholder="${S.settings.ram}" value="${o.ram || ""}"><span class="unit">${T("u.mb")}</span></div></div>
    <div class="field"><label>${T("set.java")}</label><input class="input" id="isJava" placeholder="${T("is.global")}" value="${esc(o.java || "")}"></div>
    <div class="field"><label>${T("is.jvm")}</label><p>${T("is.jvm_sub")}</p><input class="input" id="isJvm" placeholder="-XX:+UseZGC" value="${esc(o.jvm || "")}"></div>
    <div class="field"><label>${T("is.window")}</label><p>${T("is.window_sub")}</p>
      <div class="row2"><input class="input num" type="number" id="isW" placeholder="854" value="${o.width || ""}"><span class="unit">×</span>
        <input class="input num" type="number" id="isH" placeholder="480" value="${o.height || ""}">
        <span style="width:16px"></span><button class="switch ${o.fullscreen ? "on" : ""}" id="isFull" onclick="this.classList.toggle('on')"></button><span class="unit">${T("is.fullscreen")}</span></div></div>
    <button class="btn brand" onclick="saveInstSettings()">${ico("check")}${T("btn.save")}</button></div>
  <div class="panel" style="max-width:none"><div class="field" style="margin:0;display:flex;gap:14px;align-items:center">
    <div style="flex:1"><label style="margin:0">${ico("play")} ${T("sc.title")}</label><p style="margin:0">${T("sc.sub")}</p></div>
    <button class="btn brand" onclick='makeShortcut(${jsArg(i.id)})'>${ico("plus")}${T("sc.go")}</button></div></div>
  <div class="panel" style="max-width:none">
    <div class="field" style="margin:0"><label>${ico("share")} ${T("cl.title")}</label><p>${T("cl.sub")}</p>
      <div class="row2"><input class="input" id="clName" value="${esc(t("cl.default", {name: i.name}))}" maxlength="40">
        <button class="switch on" id="clWorlds" onclick="this.classList.toggle('on')"></button><span class="unit">${T("cl.worlds")}</span>
        <button class="btn brand" onclick="cloneInst()">${ico("plus")}${T("cl.go")}</button></div></div></div>`;
}
async function saveInstSettings() {
  await call("save_instance", S.current, {name: $("#isName").value, ram: $("#isRam").value, java: $("#isJava").value, jvm: $("#isJvm").value,
    width: $("#isW").value, height: $("#isH").value, fullscreen: $("#isFull").classList.contains("on")});
  toast(t("set.saved"), "ok");
}
async function cloneInst() {
  await call("clone_instance", S.current, $("#clName").value, $("#clWorlds").classList.contains("on"));
}

/* ---------- Ctrl+K command palette ---------- */
let palIdx = 0, palItems = [];
function openPalette() {
  $("#pal").classList.add("on"); const inp = $("#palIn"); inp.value = ""; inp.placeholder = t("pal.ph");
  buildPalette(""); setTimeout(() => inp.focus(), 30);
}
function closePalette() { $("#pal").classList.remove("on"); }
function paletteEntries(q) {
  const out = [], ql = q.trim().toLowerCase();
  const add = (icon, label, hint, fn) => out.push({icon, label, hint, fn});
  [["home", "home"], ["compass", "browse"], ["grid", "library"], ["server", "servers"], ["user", "skin"], ["trophy", "ach"], ["sliders", "settings"]]
    .forEach(([i, p]) => add(i, t("nav." + p), t("pal.page"), () => go(p)));
  S.instances.forEach(i => {
    if (i.status === "ready") add("play", t("pal.play", {name: i.name}), `${loaderName(i.loader)} ${i.mc}`, () => play(i.id));
    add("grid", i.name, t("pal.instance"), () => go("instance", i.id));
  });
  S.servers.forEach(s => add("server", t("pal.join", {name: s.name}), mask(s.address), () => joinServer(s.id)));
  add("plus", t("nav.new"), t("pal.action"), openCreate);
  add(streamer() ? "eye" : "eye-off", t("str.title"), t("pal.action"), toggleStreamer);
  add("users", t("fr.join_title"), t("pal.action"), joinByAddress);
  S.sets.forEach(st => add("layers", t("pal.set", {name: st.name}), t("set2.count", {n: st.items.length}), () => applySetPick(st.id)));
  add("upload", t("lib.import"), t("pal.action"), importPack);
  add("restore", t("im.btn"), t("pal.action"), openImport);
  add("folder", t("lib.folder"), t("pal.action"), () => call("open_folder"));
  add("zap", t("keys.title"), "?", showKeys);
  add("info", t("sup.chat_btn"), t("pal.action"), openSupport);
  add("info", t("sup.btn"), "GitHub", reportProblem);
  add("globe", t("sup.site"), t("pal.action"), () => call("open_url", "https://platonk381.github.io/elytra/support.html"));
  add("gift", t("wr.home_title"), "Wrapped", () => openWrapped());
  add("wings", "Elytra Flight", t("fl.home_sub"), openFlight);
  add("sidebar", t(S.settings.navwide ? "nav.collapse" : "nav.expand"), "Ctrl B", toggleNavWide);
  add(S.settings.navpos === "left" ? "dock-b" : "dock-l", t(S.settings.navpos === "left" ? "navpos.to_bottom" : "navpos.to_left"), t("pal.action"), () => setNavPos(S.settings.navpos === "left" ? "bottom" : "left"));
  add("image", t("pal.theme"), t("pal.action"), () => selectTheme(S.settings.theme === "aurora" ? "emerald" : "aurora"));
  Object.entries(LANG_NAMES).forEach(([k, [n]]) => add("globe", `${t("set.language")}: ${n}`, t("pal.action"), () => selectLang(k)));
  let res = ql ? out.filter(x => (x.label + " " + x.hint).toLowerCase().includes(ql)) : out.slice(0, 8);
  res = res.slice(0, 9);
  if (ql) res.push({icon: "search", label: t("pal.search", {q}), hint: "Modrinth", fn: () => { S.browse.query = q; openBrowse("mod"); }});
  return res;
}
function buildPalette(q) {
  palItems = paletteEntries(q); palIdx = 0; drawPalette();
}
function drawPalette() {
  $("#palList").innerHTML = palItems.length ? palItems.map((x, n) => `<div class="palrow ${n === palIdx ? "on" : ""}" onmouseenter="palIdx=${n};drawPalette()" onclick="runPalette(${n})">
      ${ico(x.icon)}<b>${esc(x.label)}</b><small>${esc(x.hint)}</small></div>`).join("") : `<div class="palrow"><small>${T("br.nothing")}</small></div>`;
}
function runPalette(n) { const x = palItems[n]; closePalette(); if (x) x.fn(); }
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#pal").classList.contains("on") ? closePalette() : openPalette(); return; }
  if (!$("#pal").classList.contains("on")) return;
  if (e.key === "Escape") closePalette();
  else if (e.key === "ArrowDown") { palIdx = Math.min(palItems.length - 1, palIdx + 1); drawPalette(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { palIdx = Math.max(0, palIdx - 1); drawPalette(); e.preventDefault(); }
  else if (e.key === "Enter") runPalette(palIdx);
});

/* ---------- first-run onboarding ---------- */
let onbStep = 0, onbTpl = "fps";
const TPLS = [["fps", "🚀"], ["shaders", "🌅"], ["vanilla", "🌱"]];
function showOnboarding() { onbStep = 0; $("#onb").classList.add("on"); renderOnb(); }
function renderOnb() {
  const s = S.settings, dots = [0, 1, 2, 3].map(n => `<i class="${n === onbStep ? "on" : n < onbStep ? "done" : ""}"></i>`).join("");
  let body = "";
  if (onbStep === 0) body = `<div class="onb-logo">${WINGS}</div><h1>${T("onb.welcome")}</h1><p>${T("onb.welcome_sub")}</p>
    <div class="lang-grid">${Object.entries(LANG_NAMES).map(([k, [n, c]]) => `<button class="${s.lang === k ? "on" : ""}" onclick="onbLang('${k}')">${c}<small>${esc(n)}</small></button>`).join("")}</div>`;
  if (onbStep === 1) body = `<h1>${T("onb.look")}</h1><p>${T("onb.look_sub")}</p>
    <div class="themes">${["emerald", "aurora"].map(id => `<div class="theme ${(s.theme === id || (id === "emerald" && s.theme !== "aurora")) ? "on" : ""}" onclick="onbTheme('${id}')">
      <div class="tprev ${id === "aurora" ? "tp-a" : "tp-m"}"><div class="r"></div><div class="c"><div class="h"></div><div class="g"><div></div><div></div><div></div></div></div></div>
      <b>${T("theme." + id)}</b><small>${T("theme." + id + "_sub")}</small></div>`).join("")}</div>
    <div class="accents" style="justify-content:center;margin-top:18px">${ACCENTS.map(c => `<button class="sw ${(s.accent || "") === c ? "on" : ""}" style="--c:${c || "var(--brand0)"}" onclick="onbAccent('${c}')">${c ? "" : ico("restore")}</button>`).join("")}</div>`;
  if (onbStep === 2) body = `<div class="onb-logo" style="background:none;box-shadow:none">${face(s.nick, 96, 'id="onbAv" data-r="20"')}</div>
    <h1>${T("onb.name")}</h1><p>${T(S.features.ms ? "onb.name_ms" : "onb.name_sub")}</p>
    ${S.features.ms ? "" : `<input class="input onb-input" id="onbNick" value="${esc(s.nick === "Player" ? "" : s.nick)}" placeholder="Steve" maxlength="16" oninput="clearTimeout(window._onbT);const v=this.value;window._onbT=setTimeout(()=>{const u=skinUrl(/^\\w{3,16}$/.test(v)?v:'Steve');$('#onbAv').style.backgroundImage='url('+u+'),url('+u+')'},450)">`}`;
  if (onbStep === 3) body = `<h1>${T("onb.first")}</h1><p>${T("onb.first_sub")}</p>
    <div class="tpls">${TPLS.map(([k, e]) => `<div class="tpl ${onbTpl === k ? "on" : ""}" onclick="onbTpl='${k}';renderOnb()"><span>${e}</span><b>${T("tpl." + k)}</b><small>${T("tpl." + k + "_sub")}</small></div>`).join("")}</div>
    <div class="row2" style="margin-top:16px"><input class="input" id="onbName" value="${esc(t("tpl." + onbTpl))}" maxlength="40"><select class="input" id="onbVer">${(S.versions.length ? S.versions : [t("cr.loading")]).slice(0, 30).map(v => `<option>${esc(v)}</option>`).join("")}</select></div>`;
  $("#onb").innerHTML = `<div class="onb-card"><div class="onb-dots">${dots}</div><div class="onb-body" key="${onbStep}">${body}</div>
    <div class="foot">${onbStep ? `<button class="btn ghost" onclick="onbGo(-1)">← ${T("br.prev")}</button>` : `<button class="btn ghost" onclick="finishOnb(false)">${T("onb.skip")}</button>`}
      <span class="spacer"></span>
      ${onbStep < 3 ? `<button class="btn brand big" onclick="onbGo(1)">${T("br.next")} →</button>`
        : `<button class="btn ghost" onclick="finishOnb(false).then(openImport)">${T("im.btn")}</button><button class="btn brand big" onclick="finishOnb(true)">${ico("rocket")}${T("onb.create")}</button>`}</div></div>`;
}
async function onbLang(l) { await saveSettingsObj({lang: l}); applyStaticText(); renderOnb(); render(); }
async function onbTheme(th) { applyTheme(th); await saveSettingsObj({theme: th}); renderOnb(); }
async function onbAccent(c) { applyAccent(c); await saveSettingsObj({accent: c}); renderOnb(); }
async function onbGo(d) {
  if (onbStep === 2 && d > 0 && $("#onbNick")) {
    const nick = $("#onbNick").value.trim();
    if (nick) { try { await saveSettingsObj({nick}); renderChrome(); } catch { return; } }
  }
  onbStep = Math.max(0, Math.min(3, onbStep + d)); renderOnb();
}
async function finishOnb(create) {
  const name = $("#onbName") ? $("#onbName").value.trim() || t("tpl." + onbTpl) : "";
  const mc = $("#onbVer") ? $("#onbVer").value : "";
  if (create && !S.versions.includes(mc)) return toast(t("cr.wait_versions"), "error");
  await saveSettingsObj({onboarded: true});
  $("#onb").classList.remove("on");
  if (create) { const id = await call("create_instance", name, mc, "fabric", null, onbTpl); go("instance", id); }
  else render();
}

/* ---------- skins: 3D viewer (pure CSS 3D, no libraries) ---------- */
const SK = 10;  // pixels per skin texel
function skFaces(url, H, w, h, d, u, v) {
  const f = (fw, fh, tu, tv, tr, shade) => `<div class="sv-face ${shade}" style="width:${fw * SK}px;height:${fh * SK}px;left:${(w - fw) * SK / 2}px;top:${(h - fh) * SK / 2}px;
    background-image:url('${url}');background-size:${64 * SK}px ${H * SK}px;background-position:${-tu * SK}px ${-tv * SK}px;transform:${tr}"></div>`;
  return f(w, h, u + d, v + d, `translateZ(${d * SK / 2}px)`, "") + f(w, h, u + 2 * d + w, v + d, `rotateY(180deg) translateZ(${d * SK / 2}px)`, "sh-back")
    + f(d, h, u, v + d, `rotateY(-90deg) translateZ(${w * SK / 2}px)`, "sh-side") + f(d, h, u + d + w, v + d, `rotateY(90deg) translateZ(${w * SK / 2}px)`, "sh-side")
    + f(w, d, u + d, v, `rotateX(90deg) translateZ(${h * SK / 2}px)`, "sh-top") + f(w, d, u + d + w, v, `rotateX(-90deg) translateZ(${h * SK / 2}px)`, "sh-bottom");
}
function skPart(cls, url, H, cx, cy, w, h, d, layers, extra = "") {
  return `<div class="sv-part ${cls}" style="width:${w * SK}px;height:${h * SK}px;left:${(cx - w / 2) * SK}px;top:${(cy - h / 2) * SK}px;${extra}">
    ${layers.map(([u, v, k]) => `<div class="sv-layer" style="transform:scale3d(${k},${k},${k})">${skFaces(url, H, w, h, d, u, v)}</div>`).join("")}</div>`;
}
function skinHtml(url, slim, legacy, capeUrl) {
  const H = legacy ? 32 : 64, aw = slim ? 3 : 4, ax = 4 + aw / 2;
  const L = (base, over) => legacy ? [base] : [base, over];
  return `<div class="sv-root" id="svRoot">
    ${skPart("head", url, H, 0, -12, 8, 8, 8, [[0, 0, 1], [32, 0, 1.125]])}
    ${skPart("body", url, H, 0, -2, 8, 12, 4, L([16, 16, 1], [16, 32, 1.06]))}
    ${skPart("arm arm-r", url, H, -ax, -2, aw, 12, 4, L([40, 16, 1], [40, 32, 1.06]), "transform-origin:50% 0 0")}
    ${skPart("arm arm-l", url, H, ax, -2, aw, 12, 4, legacy ? [[40, 16, 1]] : [[32, 48, 1], [48, 48, 1.06]], "transform-origin:50% 0 0")}
    ${skPart("leg leg-r", url, H, -2, 10, 4, 12, 4, L([0, 16, 1], [0, 32, 1.06]), "transform-origin:50% 0 0")}
    ${skPart("leg leg-l", url, H, 2, 10, 4, 12, 4, legacy ? [[0, 16, 1]] : [[16, 48, 1], [0, 48, 1.06]], "transform-origin:50% 0 0")}
    ${capeUrl ? `<div class="sv-part cape" style="width:${10 * SK}px;height:${16 * SK}px;left:${-5 * SK}px;top:${-8 * SK}px;transform-origin:50% 0 0;transform:translateZ(${-2.6 * SK}px) rotateX(12deg) rotateY(180deg)">
      <div class="sv-layer">${skFaces(capeUrl, 32, 10, 16, 1, 0, 0)}</div></div>` : ""}
  </div>`;
}
const SV = {ry: -25, rx: -8, drag: null, walk: true, slim: false};
function mountSkin(url, slim, capeUrl) {
  const box = $("#skinBox"); if (!box) return;
  const img = new Image();
  img.onload = () => { if (!$("#skinBox")) return; box.querySelector(".sv-stage").innerHTML = skinHtml(esc(url), slim, img.naturalHeight === 32, capeUrl ? esc(capeUrl) : null); applySV(); };
  img.onerror = () => { box.querySelector(".sv-stage").innerHTML = `<small>${T("sk.no_skin")}</small>`; };
  clearTimeout(SV.tmo);
  SV.tmo = setTimeout(() => { if (!img.complete && $("#skinBox")) img.onerror(); }, 25000);
  img.src = url;
}
function applySV() { const r = $("#svRoot"); if (r) r.style.transform = `rotateX(${SV.rx}deg) rotateY(${SV.ry}deg)`; }
function skinLoop() {
  if (S.page !== "skin") { SV.loop = false; return; }
  if (!SV.drag) { SV.ry += 0.25; applySV(); }
  requestAnimationFrame(skinLoop);
}
document.addEventListener("pointerdown", e => { if (e.target.closest && e.target.closest("#skinBox")) SV.drag = {x: e.clientX, y: e.clientY, ry: SV.ry, rx: SV.rx}; });
document.addEventListener("pointermove", e => {
  if (!SV.drag) return;
  SV.ry = SV.drag.ry + (e.clientX - SV.drag.x) * 0.6; SV.rx = Math.max(-40, Math.min(40, SV.drag.rx - (e.clientY - SV.drag.y) * 0.4)); applySV();
});
document.addEventListener("pointerup", () => { SV.drag = null; });

function pageSkin() {
  const acc = activeAccount(), lic = !!(S.features.ms && acc);
  const name = acc ? acc.name : (S.settings.nick || "Player");
  const p = S.skinProfile;
  return `<div class="skinpage">
    <div class="skinview ${SV.walk ? "walk" : ""}" id="skinBox"><div class="sv-stage"><span class="spin" style="width:28px;height:28px"></span></div>
      <div class="sv-tools"><button class="btn icon" title="${T("sk.walk")}" onclick="SV.walk=!SV.walk;$('#skinBox').classList.toggle('walk',SV.walk)">${ico("play")}</button>
        <button class="btn icon" title="${T("sk.reset")}" onclick="SV.ry=-25;SV.rx=-8;applySV()">${ico("restore")}</button></div>
      <small class="sv-hint">${T("sk.drag")}</small></div>
    <div class="skinside">
      <h1>${esc(mask(name))}</h1>
      <div class="tags" style="margin:8px 0 18px">${lic ? `<span class="badge ok">${ico("check")}${T("acc.licensed")}</span>` : `<span class="tag">${T("acc.offline")}</span>`}</div>
      <div class="field"><label>${T("sk.model")}</label><div class="seg" style="grid-template-columns:1fr 1fr">
        <button class="${!(p ? p.slim : SV.slim) ? "on" : ""}" onclick="SV.slim=false;${lic ? "" : "render()"}">${T("sk.classic")}</button>
        <button class="${(p ? p.slim : SV.slim) ? "on" : ""}" onclick="SV.slim=true;${lic ? "" : "render()"}">${T("sk.slim")}</button></div></div>
      ${lic ? `<div class="field"><label>${T("sk.change")}</label><p>${T("sk.change_sub")}</p>
          <div class="row2"><button class="btn brand" onclick="uploadSkin(false)">${ico("upload")}${T("sk.upload_classic")}</button><button class="btn" onclick="uploadSkin(true)">${ico("upload")}${T("sk.upload_slim")}</button></div></div>
        <div class="field"><label>${T("sk.capes")}</label>${p ? (p.capes.length ? `<div class="capes">
            <div class="capec ${p.capes.some(c => c.active) ? "" : "on"}" onclick="setCape(null)"><div class="capeimg">${ico("x")}</div><small>${T("sk.no_cape")}</small></div>
            ${p.capes.map(c => `<div class="capec ${c.active ? "on" : ""}" onclick='setCape(${jsArg(c.id)})'><div class="capeimg">${c.url ? `<div style="background-image:url('${esc(c.url)}')"></div>` : ""}</div><small>${esc(c.alias || "Cape")}</small></div>`).join("")}</div>`
            : `<p>${T("sk.no_capes")}</p>`) : `<span class="spin"></span>`}</div>`
        : `<div class="panel" style="margin:0"><p style="margin:0">${T(S.features.ms ? "sk.offline_ms" : "sk.offline")}</p></div>`}
    </div></div>`;
}
async function loadSkin() {
  const acc = activeAccount(), lic = !!(S.features.ms && acc);
  if (!SV.loop) { SV.loop = true; requestAnimationFrame(skinLoop); }
  if (lic) {
    if (!S.skinProfile) {
      try { S.skinProfile = await call("skin_profile"); } catch { S.skinProfile = {skin: null, slim: false, capes: []}; }
      if (S.page === "skin") return render();
    }
    const p = S.skinProfile, cape = (p.capes.find(c => c.active) || {}).url;
    mountSkin(p.skin || skinUrl(acc.name), SV.slim || p.slim, cape);
  } else {
    mountSkin(skinUrl(S.settings.nick || "Steve"), SV.slim, null);
  }
}
async function uploadSkin(slim) {
  const r = await call("upload_skin", slim);
  if (r) { S.skinProfile = r; toast(t("sk.updated"), "ok"); render(); }
}
async function setCape(id) { S.skinProfile = await call("set_cape", id); render(); }

