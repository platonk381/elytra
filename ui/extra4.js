/* Elytra 0.8 — usability: menus, right-click, wide nav, bulk actions, undo, library search, hotkeys */

/* ---------- generic dropdown / context menu ---------- */
// items: [{icon, label, fn, danger, disabled, kbd}] or "-" for a separator
function showMenu(items, x, y) {
  closeMenu();
  const m = document.createElement("div");
  m.id = "ctxMenu"; m.className = "menu";
  m.innerHTML = items.map((it, n) => it === "-" ? '<div class="msep"></div>'
    : `<button class="mi ${it.danger ? "danger" : ""}" ${it.disabled ? "disabled" : ""} data-n="${n}">${ico(it.icon)}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}</button>`).join("");
  document.body.appendChild(m);
  m.querySelectorAll(".mi").forEach(b => b.onclick = e => { e.stopPropagation(); closeMenu(); items[+b.dataset.n].fn(); });
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  requestAnimationFrame(() => m.classList.add("on"));
}
function closeMenu() { const m = $("#ctxMenu"); if (m) m.remove(); }
function menuAt(btn, items) {
  const r = btn.getBoundingClientRect();
  showMenu(items, r.right - 230, r.bottom + 6);
}
document.addEventListener("mousedown", e => { if (!e.target.closest("#ctxMenu")) closeMenu(); });
document.addEventListener("wheel", closeMenu, {passive: true});
window.addEventListener("blur", closeMenu);
window.addEventListener("resize", closeMenu);

/* ---------- instance actions (header "More" menu and right-click) ---------- */
function instItems(id, full) {
  const i = S.instances.find(x => x.id === id); if (!i) return [];
  const ready = i.status === "ready", busy = i.running || i.launching;
  const items = [];
  if (!full) {
    items.push(i.running ? {icon: "stop", label: t("inst.stop"), fn: () => stop(id)}
      : {icon: "play", label: t("inst.play"), fn: () => play(id), disabled: !ready || i.launching, kbd: S.current === id && S.page === "instance" ? "Ctrl ↵" : ""});
    items.push({icon: "grid", label: t("mn.open"), fn: () => go("instance", id)});
    items.push({icon: "rocket", label: t("boost.btn"), fn: () => openBoost(id), disabled: !ready});
    items.push("-");
  }
  items.push({icon: "users", label: t("fr.title"), fn: () => friendModal(id), disabled: !ready});
  items.push({icon: "steth", label: t("doc.btn"), fn: () => openDoctor(id)});
  items.push({icon: "share", label: t("share.btn"), fn: () => shareInst(id), disabled: !ready});
  items.push({icon: "plus", label: t("sc.go"), fn: () => makeShortcut(id)});
  items.push({icon: "copy", label: t("cl.title"), fn: () => { go("instance", id); S.itab = "settings"; render(); setTimeout(() => { const f = $("#clName"); if (f) { f.scrollIntoView({block: "center"}); f.select(); } }, 60); }});
  items.push({icon: "sliders", label: t("inst.tab_settings"), fn: () => { go("instance", id); S.itab = "settings"; render(); }});
  items.push({icon: "folder", label: t("inst.folder"), fn: () => call("open_folder", id)});
  items.push("-");
  items.push({icon: "trash", label: t("inst.delete"), fn: () => confirmDelete(id), danger: true, disabled: busy});
  return items;
}
function moreBtn(id) {
  return `<button class="btn big" title="${T("mn.more")}" onclick='event.stopPropagation();menuAt(this,instItems(${jsArg(id)},true))'>${ico("more")}${T("mn.more")}</button>`;
}

/* ---------- right-click everywhere it makes sense ---------- */
document.addEventListener("contextmenu", e => {
  const el = e.target.closest("[data-iid],[data-rel]");
  if (!el || e.target.closest("input,textarea")) return;
  e.preventDefault();
  if (el.dataset.iid) return showMenu(instItems(el.dataset.iid, false), e.clientX, e.clientY);
  const c = (S.content || []).find(x => x.rel === el.dataset.rel); if (!c) return;
  const sel = S.csel && S.csel.size > 1 && S.csel.has(c.rel);
  if (sel) return showMenu([
    {icon: "check", label: t("bulk.enable", {n: S.csel.size}), fn: () => bulkToggle(true)},
    {icon: "eye-off", label: t("bulk.disable", {n: S.csel.size}), fn: () => bulkToggle(false)},
    "-", {icon: "trash", label: t("bulk.delete", {n: S.csel.size}), fn: bulkDelete, danger: true}], e.clientX, e.clientY);
  showMenu([
    {icon: c.enabled ? "eye-off" : "check", label: t(c.enabled ? "mn.disable" : "mn.enable"), fn: () => toggleC(c.rel)},
    {icon: "globe", label: t("mn.modrinth"), fn: () => call("open_project_page", c.project_id), disabled: !c.project_id},
    {icon: "layers", label: t("mn.to_set"), fn: () => addToSetPick({project_id: c.project_id, title: c.title, icon: c.icon, type: c.type}), disabled: !c.project_id},
    {icon: "folder", label: t("mn.show_file"), fn: () => call("open_folder", S.current, c.rel.split("/")[0])},
    "-", {icon: "trash", label: t("inst.delete"), fn: () => removeC(c.rel), danger: true}], e.clientX, e.clientY);
});

/* ---------- wide navigation with labels ---------- */
function applyNavWide() {
  document.body.classList.toggle("navwide", !!S.settings.navwide);
  document.body.classList.toggle("navbottom", S.settings.navpos !== "left");
}
async function setNavPos(pos) { await saveSettingsObj({navpos: pos}); applyNavWide(); render(); }
async function toggleNavWide() { await saveSettingsObj({navwide: !S.settings.navwide}); applyNavWide(); renderChrome(); }

/* ---------- toasts with an action button (Undo) ---------- */
function toastAction(text, label, fn, ms = 7000) {
  const el = document.createElement("div");
  el.className = "task ok undo";
  el.innerHTML = `<b>${ico("trash")}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(text)}</span><button class="btn">${ico("restore")}${esc(label)}</button></b><div class="bar"><i></i></div>`;
  el.querySelector("i").style.animationDuration = ms + "ms";
  el.querySelector("button").onclick = async () => { el.remove(); await fn(); };
  $("#tasks").appendChild(el); setTimeout(() => el.remove(), ms);
}
async function removeC(rel) {
  const iid = S.current, c = (S.content || []).find(x => x.rel === rel);
  const token = await call("remove_content", iid, rel);
  S.csel && S.csel.delete(rel);
  loadContent();
  toastAction(t("undo.removed", {name: c ? c.title : rel}), t("undo.btn"), async () => {
    if (token) await call("restore_content", iid, token);
    if (S.current === iid) loadContent();
  });
}

/* ---------- content list: type chips, sort, checkboxes, bulk bar ---------- */
S.ctype = "all"; S.csort = "name"; S.csel = new Set();
const CTYPES = ["all", "mod", "resourcepack", "shader"];
function contentView() {
  const q = ($("#cFilter")?.value || "").toLowerCase();
  let items = S.content.filter(c => (S.ctype === "all" || c.type === S.ctype) && (!q || c.title.toLowerCase().includes(q) || c.file.toLowerCase().includes(q)));
  const by = {name: (a, b) => a.title.localeCompare(b.title), type: (a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title),
    off: (a, b) => (a.enabled - b.enabled) || a.title.localeCompare(b.title)}[S.csort];
  return items.sort(by);
}
function contentChips() {
  const cnt = k => k === "all" ? S.content.length : S.content.filter(c => c.type === k).length;
  return `<div class="chips">${CTYPES.filter(k => k === "all" || cnt(k)).map(k => `<button class="fchip ${S.ctype === k ? "on" : ""}" onclick="S.ctype='${k}';renderContent()">${T(k === "all" ? "flt.all" : "type." + k)}<span>${cnt(k)}</span></button>`).join("")}
    <span class="spacer"></span><label class="sortlbl">${T("flt.sort")}<select class="input" onchange="S.csort=this.value;renderContent()">${["name", "type", "off"].map(k => `<option value="${k}" ${S.csort === k ? "selected" : ""}>${T("csort." + k)}</option>`).join("")}</select></label></div>`;
}
function bulkBar(items) {
  if (!S.csel.size) return "";
  return `<div class="bulk"><b>${T("bulk.selected", {n: S.csel.size})}</b>
    <button class="btn ghost" onclick="selAll(true)">${T("bulk.all", {n: items.length})}</button><button class="btn ghost" onclick="selAll(false)">${T("bulk.none")}</button>
    <span class="spacer"></span>
    <button class="btn" onclick="bulkToggle(true)">${ico("check")}${T("mn.enable")}</button>
    <button class="btn" onclick="bulkToggle(false)">${ico("eye-off")}${T("mn.disable")}</button>
    <button class="btn red" onclick="bulkDelete()">${ico("trash")}${T("inst.delete")}</button></div>`;
}
function selC(rel, ev) {
  ev && ev.stopPropagation();
  const view = contentView();
  if (ev && ev.shiftKey && S.cLast) {           // shift-click selects a range
    const a = view.findIndex(c => c.rel === S.cLast), b = view.findIndex(c => c.rel === rel);
    if (a >= 0 && b >= 0) view.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(c => S.csel.add(c.rel));
  } else S.csel.has(rel) ? S.csel.delete(rel) : S.csel.add(rel);
  S.cLast = rel; renderContent();
}
function selAll(on) { S.csel = new Set(on ? contentView().map(c => c.rel) : []); renderContent(); }
async function bulkToggle(on) {
  const iid = S.current, todo = S.content.filter(c => S.csel.has(c.rel) && c.enabled !== on);
  for (const c of todo) await call("toggle_content", iid, c.rel);
  toast(t(on ? "bulk.enabled" : "bulk.disabled", {n: todo.length}), "ok");
  S.csel.clear(); loadContent();
}
async function bulkDelete() {
  const iid = S.current, rels = [...S.csel], tokens = [];
  for (const r of rels) { const tk = await call("remove_content", iid, r); if (tk) tokens.push(tk); }
  S.csel.clear(); loadContent();
  toastAction(t("undo.removed_n", {n: rels.length}), t("undo.btn"), async () => {
    for (const tk of tokens) await call("restore_content", iid, tk);
    if (S.current === iid) loadContent();
  }, 9000);
}

/* ---------- library: search + sort ---------- */
S.lq = ""; S.lsort = "recent";
function libView() {
  const q = S.lq.trim().toLowerCase();
  const by = {recent: (a, b) => (b.last_played || 0) - (a.last_played || 0), name: (a, b) => a.name.localeCompare(b.name),
    time: (a, b) => (b.playtime || 0) - (a.playtime || 0), version: (a, b) => b.mc.localeCompare(a.mc, undefined, {numeric: true})}[S.lsort];
  return S.instances.filter(i => !q || (i.name + " " + i.mc + " " + i.loader).toLowerCase().includes(q)).sort(by);
}
function libTools() {
  if (S.instances.length < 2) return "";
  return `<div class="sectionbar" style="margin-bottom:16px">
    <div class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" id="libQ" placeholder="${T("lib.search")}" value="${esc(S.lq)}" oninput="S.lq=this.value;drawLibGrid()"></div>
    <select class="input" style="width:auto" onchange="S.lsort=this.value;drawLibGrid()">${["recent", "name", "time", "version"].map(k => `<option value="${k}" ${S.lsort === k ? "selected" : ""}>${T("lsort." + k)}</option>`).join("")}</select></div>`;
}
function libGrid() {
  const v = libView();
  return v.length ? `<div class="grid">${v.map(instCard).join("")}</div>` : `<div class="empty"><b>${T("br.nothing")}</b>${T("lib.nothing_sub")}</div>`;
}
function drawLibGrid() { const g = $("#libGrid"); if (g) g.innerHTML = libGrid(); }

/* ---------- Discover: permanent "Install to" selector ---------- */
function targetSelect() {
  const b = S.browse, ok = S.instances.filter(i => i.status === "ready");
  return `<label class="tgtsel">${ico("download")}<span>${T("br.to")}</span><select class="input" onchange="pickTarget(this.value)">
    <option value="">${T("br.to_ask")}</option>${ok.map(i => `<option value="${esc(i.id)}" ${i.id === b.target ? "selected" : ""}>${esc(i.name)} · ${esc(loaderName(i.loader))} ${esc(i.mc)}</option>`).join("")}</select></label>`;
}
function pickTarget(id) {
  if (!id) return clearTarget();
  setTarget(id); S.browse.offset = 0; S.browse.hits = null; render();
}

/* ---------- drag & drop: mods/packs straight into the open instance ---------- */
function dropText() {
  const i = S.page === "instance" && S.instances.find(x => x.id === S.current);
  $("#drop b").textContent = i ? t("drop.title_inst", {name: i.name}) : t("drop.title");
  $("#drop span").textContent = i ? t("drop.sub_inst") : t("drop.sub");
}
document.addEventListener("dragenter", e => { if (isFileDrag(e)) dropText(); }, true);

/* ---------- keyboard shortcuts ---------- */
const PAGES = ["home", "browse", "library", "servers", "skin", "ach", "settings"];
const typing = () => { const a = document.activeElement; return a && (["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) || a.isContentEditable); };
function focusSearch() {
  const f = $("#cFilter") || $("#q") || $("#libQ");
  if (f) { f.focus(); f.select(); return true; }
  return false;
}
document.addEventListener("keydown", e => {
  if ($("#pal").classList.contains("on") || $("#onb").classList.contains("on")) return;
  if (e.key === "Escape") { closeMenu(); if (S.csel.size && !$("#modal").classList.contains("open")) { S.csel.clear(); renderContent(); } return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && /^[1-7]$/.test(e.key)) { e.preventDefault(); closeModal(); go(PAGES[+e.key - 1]); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); openCreate(); return; }
  if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); focusSearch() || openPalette(); return; }
  if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); toggleNavWide(); return; }
  if (mod && e.key === "Enter") {
    e.preventDefault();
    const i = S.page === "instance" ? S.instances.find(x => x.id === S.current)
      : [...S.instances].filter(x => x.status === "ready").sort((a, b) => (b.last_played || 0) - (a.last_played || 0))[0];
    if (i && i.status === "ready" && !i.running && !i.launching) play(i.id);
    return;
  }
  if (mod && e.key.toLowerCase() === "a" && !typing() && S.page === "instance" && S.itab === "content") { e.preventDefault(); selAll(true); return; }
  if (e.key === "Delete" && !typing() && S.csel.size && S.page === "instance") { e.preventDefault(); bulkDelete(); return; }
  if (typing() || mod || $("#modal").classList.contains("open")) return;
  if (e.key === "/") { e.preventDefault(); focusSearch(); }
  else if (e.key === "?") { e.preventDefault(); showKeys(); }
});
function showKeys() {
  const rows = [["Ctrl K", "keys.palette"], ["Ctrl 1…7", "keys.pages"], ["Ctrl N", "keys.new"], ["Ctrl ↵", "keys.play"], ["/  ·  Ctrl F", "keys.search"],
    ["Ctrl B", "keys.nav"], ["Ctrl A", "keys.select"], ["Shift + click", "keys.range"], ["Del", "keys.delete"], ["RMB", "keys.ctx"], ["Esc", "keys.esc"], ["F11", "keys.full"], ["?", "keys.help"]];
  modal(`<h3 style="gap:10px">${ico("zap")}${T("keys.title")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <div class="keys">${rows.map(([k, l]) => `<div><kbd>${esc(k)}</kbd><span>${T(l)}</span></div>`).join("")}</div>`);
}

/* ---------- small hooks into the existing app ---------- */
const _go = go;
go = function (page, arg) {
  if (page !== "instance" || arg !== S.current) S.csel.clear();
  _go(page, arg);
  call("set_context", page === "instance" ? S.current : null).catch(() => {});
};
const _renderChrome = renderChrome;
renderChrome = function () {
  _renderChrome();
  applyNavWide();
  document.querySelectorAll("#railInst .rail-inst").forEach((el, n) => {
    const i = S.instances.slice(0, 4)[n]; if (!i) return;
    el.dataset.iid = i.id;
    if (!el.querySelector(".lbl")) el.insertAdjacentHTML("beforeend", `<span class="lbl">${esc(i.name)}</span>`);
  });
  const nb = $("#navToggle");
  if (nb) nb.querySelector(".tip").textContent = t(S.settings.navwide ? "nav.collapse" : "nav.expand");
};
