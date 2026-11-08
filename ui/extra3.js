"use strict";
/* Elytra 0.7: moving from other launchers, desktop shortcuts, game start progress, modpack versions, similar mods */

/* ---------- moving from other launchers ---------- */
const SOURCES = {official: "Minecraft Launcher", tlauncher: "TLauncher", prism: "Prism Launcher", multimc: "MultiMC", curseforge: "CurseForge", modrinth: "Modrinth App"};
let importFound = [];
async function openImport() {
  modal(`<div class="doc-head"><div class="di">${ico("upload")}</div><div><h3 style="margin:0">${T("im.title")}</h3><small>${T("im.sub")}</small></div>
    <button class="btn icon ghost" style="margin-left:auto" onclick="closeModal()">${ico("x")}</button></div>
    <div class="skel" style="height:180px"></div>`, true);
  try { importFound = await call("scan_launchers"); } catch { importFound = []; }
  const ok = importFound.filter(e => e.supported);
  modal(`<div class="doc-head"><div class="di">${ico("upload")}</div><div><h3 style="margin:0">${T("im.title")}</h3><small>${T("im.sub")}</small></div>
      <button class="btn icon ghost" style="margin-left:auto" onclick="closeModal()">${ico("x")}</button></div>
    ${importFound.length ? `<div class="implist">${importFound.map(e => `<label class="imp ${e.supported ? "" : "off"}">
        <input type="checkbox" value="${esc(e.id)}" ${e.supported ? "checked" : "disabled"}>
        <div class="impsrc">${esc(SOURCES[e.source] || e.source)}</div>
        <div class="impinfo"><b>${esc(e.name)}</b><small>${e.mc ? `${esc(loaderName(e.loader))} ${esc(e.mc)}` : T("im.unknown")}${e.supported ? "" : ` — ${T("im.unsupported")}`}</small></div>
        <div class="impn"><span>${ico("download")}${e.mods}</span><span>${ico("archive")}${e.worlds}</span></div></label>`).join("")}</div>
      <div class="field" style="display:flex;gap:12px;align-items:center;margin-top:14px"><button class="switch on" id="imWorlds" onclick="this.classList.toggle('on')"></button><span>${T("im.worlds")}</span></div>
      <p class="hint">${ico("check")}${T("im.safe")}</p>`
      : `<div class="empty"><b>${T("im.none")}</b>${T("im.none_sub")}</div>`}
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button>
      ${ok.length ? `<button class="btn brand" onclick="doImport()">${ico("upload")}${T("im.go")}</button>` : ""}</div>`, true);
}
async function doImport() {
  const ids = [...document.querySelectorAll(".implist input:checked")].map(i => i.value);
  if (!ids.length) return toast(t("err.nothing_selected"), "error");
  await call("import_launchers", ids, $("#imWorlds").classList.contains("on"));
  closeModal(); go("library");
}

/* ---------- desktop shortcut ---------- */
async function makeShortcut(id) {
  const name = await call("create_shortcut", id);
  toast(t("sc.done", {name}), "ok");
}

/* ---------- game start progress ---------- */
const STAGES = ["java", "mods", "window", "resources", "ready"];
const launchState = {};
function onLaunchStage(d) {
  const st = launchState[d.id] = Object.assign(launchState[d.id] || {t0: Date.now()}, {stage: d.stage});
  if (d.mods) st.mods = d.mods;
  drawLaunch(d.id);
  if (d.stage >= STAGES.length - 1) setTimeout(() => closeLaunch(d.id), 2200);
}
function drawLaunch(id) {
  const st = launchState[id], i = S.instances.find(x => x.id === id); if (!st || !i) return;
  let el = document.getElementById("launch-" + id);
  if (!el) { el = document.createElement("div"); el.className = "launchcard"; el.id = "launch-" + id; document.body.appendChild(el); }
  const pct = Math.round((st.stage + 1) / STAGES.length * 100), done = st.stage >= STAGES.length - 1;
  el.innerHTML = `<div class="lchead"><div class="ic">${icon(i.icon, i.name)}</div>
      <div><b>${T(done ? "ls.done" : "ls.title", {name: i.name})}</b><small>${T("ls.sec", {n: Math.round((Date.now() - st.t0) / 1000)})}</small></div>
      <button class="btn icon ghost" onclick='closeLaunch(${jsArg(id)})'>${ico("x")}</button></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <ol class="lsteps">${STAGES.map((k, n) => `<li class="${n < st.stage || done ? "ok" : n === st.stage ? "now" : ""}">
      ${n < st.stage || done ? ico("check") : n === st.stage ? '<span class="spin"></span>' : "<i></i>"}
      ${T("ls." + k, {n: st.mods || "…"})}</li>`).join("")}</ol>`;
}
function closeLaunch(id) {
  const el = document.getElementById("launch-" + id);
  if (el) { el.classList.add("out"); setTimeout(() => el.remove(), 300); }
  delete launchState[id];
}
setInterval(() => Object.keys(launchState).forEach(drawLaunch), 1000);

/* ---------- modpack version picker ---------- */
async function pickPackVersion(pid, title) {
  modal(`<div class="skel" style="height:260px"></div>`, true);
  let vers; try { vers = await call("pack_versions", pid); } catch { return closeModal(); }
  const mcs = [...new Set(vers.flatMap(v => v.mc))].sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
  const rows = filter => vers.filter(v => !filter || v.mc.includes(filter)).map((v, n) => `<div class="vrow ${n === 0 && !filter ? "latest" : ""}">
      <div><b>${esc(v.name)}</b><small>${esc(v.mc.slice(0, 4).join(", "))}${v.mc.length > 4 ? " …" : ""}</small></div>
      <div class="tags">${v.loaders.map(l => `<span class="tag">${esc(loaderName(l))}</span>`).join("")}${v.type !== "release" ? `<span class="badge warn">${esc(v.type)}</span>` : ""}</div>
      <small>${esc(v.date)}</small>
      <button class="btn ${n === 0 && !filter ? "brand" : ""}" onclick='closeModal();installPackVersion(${jsArg(pid)},${jsArg(title)},${jsArg(v.id)})'>${ico("download")}${T("br.install")}</button></div>`).join("")
    || `<div class="empty"><b>${T("pv.none")}</b></div>`;
  modal(`<h3>${T("pv.title", {name: title})}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <div class="row2" style="margin-bottom:12px"><span class="unit">${T("pv.mc")}</span>
      <select class="input" onchange="document.getElementById('vlist').innerHTML=this.__rows(this.value)" id="pvSel">
        <option value="">${T("br.all_versions")}</option>${mcs.map(m => `<option>${esc(m)}</option>`).join("")}</select></div>
    <div class="vlist" id="vlist">${rows("")}</div>`, true);
  $("#pvSel").__rows = rows;
}
async function installPackVersion(pid, title, vid) {
  await call("install_modpack", pid, title, vid); toast(t("br.pack_installing", {name: title}), "ok");
}

/* ---------- similar mods ---------- */
async function loadSuggestions(id) {
  const box = $("#sugBox"); if (!box) return;
  let list; try { list = await call("suggest", id); } catch { list = []; }
  if (S.current !== id || !$("#sugBox")) return;
  $("#sugBox").innerHTML = list.length ? `<h2>${ico("compass")}${T("sug.title")}</h2><div class="suggrid">${list.map(x => `<div class="sug" id="sug-${esc(x.project_id)}">
      <div class="ic">${icon(x.icon_url, x.title)}</div>
      <div class="sugb"><b>${esc(x.title)}</b><small>${T(x.reason.key, x.reason.params)}</small></div>
      <button class="btn icon brand" title="${T("br.install")}" onclick='installSuggestion(${jsArg(x.project_id)})'>${ico("download")}</button></div>`).join("")}</div>` : "";
}
async function installSuggestion(pid) {
  await call("install_project", pid, "mod", S.current);
  const el = document.getElementById("sug-" + pid); if (el) el.remove();
}

/* start the app once all scripts are loaded */
if (window.pywebview && window.pywebview.api) init(); else window.addEventListener("pywebviewready", init);
