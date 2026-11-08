/* Elytra 0.12 — build an instance from a description ("horror survival with magic for a weak PC") */
let PACK = null, packText = "";
const PACK_EXAMPLES = ["pack.ex1", "pack.ex2", "pack.ex3", "pack.ex4"];

function openDescribe(text) {
  PACK = null;
  modal(`<div class="doc-head"><div class="di magic">✨</div><div><h3 style="margin:0">${T("pack.title")}</h3><small>${T("pack.sub")}</small></div>
      <button class="btn icon ghost" style="margin-left:auto" onclick="closeModal()">${ico("x")}</button></div>
    <textarea class="input packtext" id="packText" rows="3" maxlength="600" placeholder="${esc(t("pack.ph"))}">${esc(text ?? packText)}</textarea>
    <div class="packex">${PACK_EXAMPLES.map(k => `<button class="fchip" onclick="$('#packText').value=this.textContent;$('#packText').focus()">${esc(t(k))}</button>`).join("")}</div>
    <div class="packtips">${ico("info")}<span>${T("pack.tips")}</span></div>
    <div class="foot"><button class="btn" onclick="closeModal()">${T("btn.cancel")}</button>
      <button class="btn brand" id="packGo" onclick="packPlan()">✨ ${T("pack.go")}</button></div>`, true);
  const ta = $("#packText"); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); packPlan(); } });
}

let packStepTimer = null;
async function packPlan() {
  const ta = $("#packText"), btn = $("#packGo"); if (!ta) return;
  packText = ta.value.trim(); if (!packText) return ta.focus();
  btn.disabled = true;
  const steps = ["pack.s1", "pack.s2", "pack.s3"]; let i = 0;
  const show = () => { if (btn) btn.innerHTML = `<span class="spin"></span>${T(steps[Math.min(i, 2)])}`; i++; };
  show(); clearInterval(packStepTimer); packStepTimer = setInterval(show, 2200);
  let r = null;
  try { r = await call("pack_plan", packText); } finally { clearInterval(packStepTimer); }
  if (!r) { if ($("#packGo")) { $("#packGo").disabled = false; $("#packGo").innerHTML = `✨ ${T("pack.go")}`; } return; }
  PACK = r; PACK.off = new Set(); showPlan();
}

function showPlan() {
  const p = PACK, L = p.labels || {};
  const groups = {};
  p.mods.forEach(m => (groups[m.reason] = groups[m.reason] || []).push(m));
  const order = [...p.themes, "friends", "map", "shaders", "qol", "perf"].filter(k => groups[k]);
  const on = p.mods.filter(m => !PACK.off.has(m.id)).length;
  modal(`<div class="doc-head"><div class="di magic">✨</div><div style="flex:1;min-width:0"><input class="input packname" id="packName" maxlength="60" value="${esc(p.name)}">
      <div class="packmeta"><span class="tag">${esc(loaderName(p.loader))} ${esc(p.mc)}</span>${p.themes.map(th => `<span class="tag th">${esc(L[th] || th)}</span>`).join("")}
        ${p.flags.includes("weak") ? `<span class="tag">⚡ ${T("pack.weak")}</span>` : ""}${p.shaders.length ? `<span class="tag">🌅 ${esc(L.shaders || "Shaders")}</span>` : ""}</div></div>
      <button class="btn icon ghost" onclick="closeModal()">${ico("x")}</button></div>
    <div class="packlist">${order.map(k => `<div class="packgroup"><b>${esc(L[k] || k)}</b>${groups[k].map(m => `
      <label class="packmod ${PACK.off.has(m.id) ? "off" : ""}"><input type="checkbox" ${PACK.off.has(m.id) ? "" : "checked"} onchange='packToggle(${jsArg(m.id)}, this)'>
        <span class="packico">${icon(m.icon, m.title)}</span><div><b>${esc(m.title || m.slug)}</b><small>${esc(m.desc || "")}</small></div>
        ${m.downloads ? `<span class="dl">${ico("download")}${fmt(m.downloads)}</span>` : ""}</label>`).join("")}</div>`).join("")}</div>
    <p class="hint">${ico("info")}${T("pack.deps_note")}${p.dropped ? " " + t("pack.dropped", {n: p.dropped}) : ""}</p>
    <div class="foot"><button class="btn" onclick="openDescribe()">${ico("edit")}${T("pack.change")}</button>
      <button class="btn brand" id="packCreate" onclick="packCreate()">${ico("plus")}${T("pack.create", {n: on})}</button></div>`, true);
}
function packToggle(id, el) {
  el.checked ? PACK.off.delete(id) : PACK.off.add(id);
  el.closest(".packmod").classList.toggle("off", !el.checked);
  const b = $("#packCreate"); if (b) b.innerHTML = `${ico("plus")}${T("pack.create", {n: PACK.mods.filter(m => !PACK.off.has(m.id)).length})}`;
}
async function packCreate() {
  const p = PACK; if (!p) return;
  const name = ($("#packName")?.value || p.name).trim() || p.name;
  const mods = p.mods.filter(m => !PACK.off.has(m.id)).map(m => m.id);
  $("#packCreate").disabled = true;
  const iid = await call("pack_create", name, p.mc, p.loader, mods, p.shaders, p.flags.includes("weak"));
  if (!iid) { $("#packCreate").disabled = false; return; }
  closeModal(); toast(t("pack.started", {name}), "ok");
  setTimeout(() => S.instances.some(i => i.id === iid) ? go("instance", iid) : go("library"), 400);
}
