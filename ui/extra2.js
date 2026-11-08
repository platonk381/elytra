"use strict";
/* Elytra 0.6: streamer mode, mod sets, play with a friend, achievements */

/* ---------- streamer mode ---------- */
const streamer = () => !!S.settings.streamer;
const mask = txt => streamer() ? "•".repeat(Math.min(14, Math.max(6, String(txt || "").length))) : txt;
function applyStreamer() { document.body.classList.toggle("streamer", streamer()); }
async function toggleStreamer() {
  await saveSettingsObj({streamer: !streamer()}); applyStreamer(); render();
  toast(t(streamer() ? "str.on" : "str.off"), "ok");
}
function streamerBtn() {
  return `<button class="chip strbtn ${streamer() ? "on" : ""}" title="${T("str.title")}" onclick="toggleStreamer()">${ico(streamer() ? "eye-off" : "eye")}${streamer() ? `<span>${T("str.live")}</span>` : ""}</button>`;
}

/* ---------- mod sets ---------- */
function setIcons(st) {
  return `<div class="seticons">${st.items.slice(0, 5).map(it => `<div class="ic">${icon(it.icon, it.title)}</div>`).join("")}${st.items.length > 5 ? `<div class="ic more">+${st.items.length - 5}</div>` : ""}</div>`;
}
function setsSection() {
  return `<h2>${ico("layers")}${T("set2.title")} <a onclick="newSet()">+ ${T("set2.new")}</a></h2>
    ${S.sets.length ? `<div class="setgrid">${S.sets.map(st => `<div class="setcard">
        ${setIcons(st)}<b>${esc(st.name)}</b><small>${T("set2.count", {n: st.items.length})}</small>
        <div class="acts"><button class="btn brand" onclick='applySetPick(${jsArg(st.id)})'>${ico("download")}${T("set2.install")}</button>
          <button class="btn icon" title="${T("set2.edit")}" onclick='openSet(${jsArg(st.id)})'>${ico("edit")}</button></div></div>`).join("")}</div>`
      : `<div class="empty"><b>${T("set2.empty")}</b>${T("set2.empty_sub")}</div>`}`;
}
function newSet(iid) {
  modal(`<h3>${T(iid ? "set2.from_inst" : "set2.new")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    <p>${T(iid ? "set2.from_inst_sub" : "set2.new_sub")}</p>
    <div class="field"><input class="input" id="setName" maxlength="40" placeholder="${T("set2.name_ph")}" style="width:100%"></div>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button>
      <button class="btn brand" onclick='createSet(${jsArg(iid || null)})'>${ico("check")}${T("btn.save")}</button></div>`);
  setTimeout(() => $("#setName")?.focus(), 50);
}
async function createSet(iid) {
  const name = $("#setName").value.trim(); if (!name) return toast(t("err.name_required"), "error");
  S.sets = iid ? await call("set_from_instance", iid, name) : await call("save_set", null, name, []);
  closeModal(); toast(t("set2.saved", {name}), "ok"); if (S.page === "library") render();
}
function openSet(sid) {
  const st = S.sets.find(x => x.id === sid); if (!st) return;
  modal(`<h3><input class="input" id="setName" value="${esc(st.name)}" maxlength="40" style="flex:1;margin-right:10px"><button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    ${st.items.length ? `<div class="table">${st.items.map(it => `<div class="brow" style="grid-template-columns:40px 1fr auto auto">
        <div class="ic" style="width:40px;height:40px;border-radius:10px;overflow:hidden">${icon(it.icon, it.title)}</div>
        <div><b>${esc(it.title)}</b><small>${T("type1." + it.type)}</small></div><span></span>
        <button class="btn icon ghost" onclick='removeFromSet(${jsArg(sid)},${jsArg(it.project_id)})'>${ico("trash")}</button></div>`).join("")}</div>`
      : `<div class="empty"><b>${T("set2.empty_items")}</b>${T("set2.empty_items_sub")}</div>`}
    <div class="foot"><button class="btn red" style="margin-right:auto" onclick='deleteSet(${jsArg(sid)})'>${ico("trash")}${T("inst.delete")}</button>
      <button class="btn" onclick="closeModal();openBrowse('mod')">${ico("compass")}${T("set2.add_more")}</button>
      <button class="btn brand" onclick='renameSet(${jsArg(sid)})'>${ico("check")}${T("btn.save")}</button></div>`, true);
}
async function renameSet(sid) {
  const st = S.sets.find(x => x.id === sid);
  S.sets = await call("save_set", sid, $("#setName").value, st.items); closeModal(); render();
}
async function removeFromSet(sid, pid) {
  const st = S.sets.find(x => x.id === sid);
  S.sets = await call("save_set", sid, st.name, st.items.filter(i => i.project_id !== pid)); openSet(sid);
}
async function deleteSet(sid) { S.sets = await call("delete_set", sid); closeModal(); render(); }
function applySetPick(sid) {
  const ready = S.instances.filter(i => i.status === "ready");
  modal(`<h3>${T("set2.where")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    ${ready.length ? ready.map(i => `<div class="pick" onclick='closeModal();call("apply_set",${jsArg(sid)},${jsArg(i.id)})'>
      <div class="ic">${icon(i.icon, i.name)}</div><div><b>${esc(i.name)}</b><br><small>${esc(loaderName(i.loader))} ${esc(i.mc)}</small></div></div>`).join("")
      : `<div class="empty"><b>${T("lib.empty")}</b></div>`}`);
}
function addToSetPick(item) {
  modal(`<h3>${T("set2.add_to", {name: item.title})}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3>
    ${S.sets.map(st => `<div class="pick" onclick='addToSet(${jsArg(st.id)},${jsArg(item)})'>${setIcons(st)}<div><b>${esc(st.name)}</b><br><small>${T("set2.count", {n: st.items.length})}</small></div></div>`).join("")}
    <div class="foot"><button class="btn brand" onclick='newSetWith(${jsArg(item)})'>${ico("plus")}${T("set2.new")}</button></div>`);
}
async function addToSet(sid, item) { S.sets = await call("add_to_set", sid, item); closeModal(); toast(t("set2.added", {name: item.title}), "ok"); }
async function newSetWith(item) {
  const name = t("set2.default");
  S.sets = await call("save_set", null, name, [item]); closeModal(); toast(t("set2.added", {name: item.title}), "ok");
}

/* ---------- play with a friend ---------- */
S.friend = {};
function friendModal(id) {
  const i = S.instances.find(x => x.id === id); if (!i) return;
  if (i.loader === "vanilla") return modal(`<h3>${T("fr.title")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3><p>${T("fr.vanilla")}</p>
    <div class="foot"><button class="btn brand" onclick="closeModal();openCreate()">${ico("plus")}${T("lib.create")}</button></div>`);
  const link = S.friend[id];
  modal(`<div class="doc-head"><div class="di">${ico("users")}</div><div><h3 style="margin:0">${T("fr.title")}</h3><small>${T("fr.sub")}</small></div>
      <button class="btn icon ghost" style="margin-left:auto" onclick="closeModal()">${ico("x")}</button></div>
    ${link ? linkBox(link) : `<div class="steps">
      <div class="stepi"><span>1</span><p>${T("fr.s1")}</p></div>
      <div class="stepi"><span>2</span><p>${T("fr.s2")}</p></div>
      <div class="stepi"><span>3</span><p>${T("fr.s3")}</p></div></div>`}
    <p class="hint">${ico("alert")}${T("fr.same_mods")}</p>
    <div class="foot"><button class="btn" onclick='closeModal();shareInst(${jsArg(id)})'>${ico("share")}${T("fr.send_inst")}</button>
      ${link ? "" : `<button class="btn brand" id="frGo" onclick='startFriend(${jsArg(id)})'>${ico("play")}${T("fr.go")}</button>`}</div>`, true);
}
function linkBox(link) {
  return `<div class="linkbox"><small>${T("fr.your_link")}</small>
    <div class="linkrow"><code id="frLink" data-v="${esc(link)}">${esc(mask(link))}</code>
      ${streamer() ? `<button class="btn icon" title="${T("fr.reveal")}" onclick="$('#frLink').textContent=$('#frLink').dataset.v">${ico("eye")}</button>` : ""}
      <button class="btn brand" onclick='copyText(${jsArg(link)})'>${ico("copy")}${T("sh.copy")}</button></div>
    <small>${T("fr.link_sub")}</small></div>`;
}
async function startFriend(id) {
  const b = $("#frGo"); if (b) { b.disabled = true; b.innerHTML = `<span class="spin"></span>${T("fr.preparing")}`; }
  try { await call("prepare_friend", id); } catch { if (b) { b.disabled = false; b.innerHTML = ico("play") + T("fr.go"); } return; }
  closeModal(); await play(id); toast(t("fr.started"), "ok");
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast(t("sh.copied"), "ok"); } catch { toast(t("sh.copy_fail"), "error"); }
}
function joinByAddress() {
  const ready = S.instances.filter(i => i.status === "ready");
  modal(`<h3>${T("fr.join_title")}<button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></h3><p>${T("fr.join_sub")}</p>
    <div class="field"><label>${T("srv.address")}</label><input class="input" id="jAddr" type="${streamer() ? "password" : "text"}" placeholder="name.e4mc.link" style="width:100%"></div>
    <div class="field"><label>${T("srv.instance")}</label><select class="input" id="jInst" style="width:100%">${ready.map(i => `<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.mc)}</option>`).join("")}</select></div>
    <div class="field" style="display:flex;gap:12px;align-items:center"><button class="switch" id="jSave" onclick="this.classList.toggle('on')"></button><span>${T("fr.save_server")}</span></div>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button><button class="btn brand" onclick="doJoin()">${ico("play")}${T("srv.join")}</button></div>`);
  setTimeout(() => $("#jAddr")?.focus(), 50);
}
async function doJoin() {
  const addr = $("#jAddr").value.trim(), iid = $("#jInst").value;
  if (!addr || !iid) return;
  if ($("#jSave").classList.contains("on")) S.servers = await call("save_server", {name: addr.split(".")[0], address: addr, instance: iid});
  closeModal(); play(iid, addr);
}

/* ---------- achievements ---------- */
S.ach = null;
function achIcon(a) { return a.emoji === "wings" ? WINGS : esc(a.emoji); }
function achValue(a) {
  const v = a.value || 0;
  return (a.id.startsWith("hours") || a.id.startsWith("elytra") || a.id.startsWith("walker")) ? v.toFixed(1) : fmtNum(Math.floor(v));
}
function pageAch() {
  const list = S.ach || [];
  const got = list.filter(a => a.unlocked).length;
  const sorted = [...list].sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0) || (b.value / b.goal) - (a.value / a.goal));
  return `<div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap"><div><h1>${T("ach.title")}</h1><p style="color:var(--muted);margin-top:4px">${T("ach.sub")}</p></div>
      <span class="spacer"></span><div class="achsum"><b>${got}</b><span>/ ${list.length}</span><div class="bar"><i style="width:${list.length ? got / list.length * 100 : 0}%"></i></div></div></div>
    ${S.ach ? `<div class="achgrid">${sorted.map((a, n) => `<div class="ach ${a.unlocked ? "got" : ""}" style="animation-delay:${Math.min(n, 20) * 30}ms">
        <div class="achic">${achIcon(a)}</div>
        <div class="achb"><b>${T("ach." + a.id)}</b><small>${T("ach." + a.id + "_d")}</small>
          ${a.unlocked ? `<span class="achdate">${ico("check")}${esc(fmtDate(a.unlocked))}</span>`
            : `<div class="bar"><i style="width:${Math.min(100, a.value / a.goal * 100)}%"></i></div><span class="achp">${esc(achValue(a))} / ${esc(fmtNum(a.goal))}</span>`}</div></div>`).join("")}</div>`
      : `<div class="skel" style="height:300px;margin-top:20px"></div>`}`;
}
async function loadAch() {
  try { S.ach = await call("get_achievements"); } catch { S.ach = []; }
  if (S.page === "ach") { const m = $("#main"); m.innerHTML = `<div class="page">${pageAch()}</div>`; }
}
const achQueue = [];
function showAchievement(a) {
  achQueue.push(a); if (achQueue.length === 1) nextAch();
  if (S.ach) { const x = S.ach.find(y => y.id === a.id); if (x) Object.assign(x, a); }
}
function nextAch() {
  const a = achQueue[0]; if (!a) return;
  const el = document.createElement("div"); el.className = "achpop";
  el.innerHTML = `<div class="achburst">${Array.from({length: 14}, (_, i) => `<i style="--a:${i * 360 / 14}deg;--d:${60 + Math.random() * 50}px"></i>`).join("")}</div>
    <div class="achic">${achIcon(a)}</div><div><small>${T("ach.unlocked")}</small><b>${T("ach." + a.id)}</b><span>${T("ach." + a.id + "_d")}</span></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("out"), 4200);
  setTimeout(() => { el.remove(); achQueue.shift(); nextAch(); if (S.page === "ach") render(); }, 4700);
}

