/* Elytra 0.9 — network sources (mirrors), log */
const NET_GROUPS = ["modrinth", "mojang", "assets", "fabric", "forge", "quilt"];
function netRows() {
  const n = S.net || {};
  return NET_GROUPS.map(g => {
    const st = n[g] || "wait";
    const cls = {official: "ok", mirror: "mir", down: "bad", unknown: "wait", wait: "wait"}[st];
    return `<div class="netrow"><b>${T("net.g_" + g)}</b><span class="netst ${cls}">${st === "wait" ? '<span class="spin" style="width:12px;height:12px"></span>' : ico(cls === "ok" ? "check" : cls === "mir" ? "refresh" : cls === "bad" ? "x" : "info")}${T("net.s_" + st)}</span></div>`;
  }).join("");
}
function netPanel() {
  const src = S.settings.netsrc || "auto";
  return `<div class="panel"><div class="field" style="margin-bottom:14px"><label>${ico("globe")} ${T("net.title")}</label><p>${T("net.sub")}</p>
    <div class="seg" style="grid-template-columns:repeat(3,1fr)">${["auto", "official", "mirror"].map(k => `<button class="${src === k ? "on" : ""}" style="text-transform:none" onclick="setNetSrc('${k}')">${T("net.m_" + k)}</button>`).join("")}</div></div>
    <div class="netgrid" id="netGrid">${netRows()}</div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn" onclick="recheckNet()">${ico("refresh")}${T("net.recheck")}</button>
      <button class="btn ghost" onclick="call('open_app_log')">${ico("file")}${T("net.log")}</button>
      <button class="btn ghost" onclick="openSupport()">${ico("info")}${T("sup.chat_btn")}</button>
      <button class="btn ghost" onclick="call('open_url','https://platonk381.github.io/elytra/support.html')">${ico("globe")}${T("sup.site")}</button></div>
    <p style="font-size:12px;color:var(--muted);margin:10px 0 0">${T("sup.sub")}</p>
    <p style="font-size:12px;color:var(--muted);margin:12px 0 0">${T("net.credit")}</p></div>`;
}
function drawNet() { const g = $("#netGrid"); if (g) g.innerHTML = netRows(); }
async function setNetSrc(k) { await saveSettingsObj({netsrc: k}); render(); recheckNet(); }
async function recheckNet() { S.net = {}; drawNet(); await call("recheck_network"); }

/* Support: copy a diagnostic report and open the GitHub form */
async function reportProblem() {
  const r = await call("support_report");
  if (!r) return;
  let ok = r.copied;
  if (!ok) { try { await navigator.clipboard.writeText(r.text); ok = true; } catch (e) {} }
  if (ok) return toast(t("sup.copied"), "ok");
  toast(t("sup.manual"), "error");
  const pre = document.createElement("textarea"); pre.value = r.text; pre.readOnly = true;
  pre.style.cssText = "width:100%;height:220px;margin-top:12px;font:12px monospace;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:10px;padding:10px";
  const g = $("#netGrid"); if (g) { g.parentNode.appendChild(pre); pre.select(); }
}

/* Support chat: messages go to the developer's Telegram, replies come back here */
let supOpen = false, supTimer = null;
function supBubbles(msgs) {
  if (!msgs.length) return `<div class="supempty">${ico("info")}<div><b>${T("sup.hello")}</b><p>${T("sup.hello_sub")}</p></div></div>`;
  return msgs.map(m => `<div class="supmsg ${m.from === "dev" ? "dev" : "me"}"><div class="supb">${esc(m.text).replace(/\n/g, "<br>")}</div>
    <small>${m.from === "dev" ? T("sup.dev") + " · " : ""}${new Date(m.ts * 1000).toLocaleString([], {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"})}</small></div>`).join("");
}
function drawSupport(msgs) {
  const box = $("#supList"); if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = supBubbles(msgs);
  if (atBottom || !box.dataset.init) { box.scrollTop = box.scrollHeight; box.dataset.init = 1; }
}
async function openSupport() {
  const r = await call("support_chat", false);
  if (!r) return;
  if (!r.enabled) return reportProblem();
  S.supUnread = 0; renderChrome();
  const first = !r.msgs.length;
  modal(`<div class="suphead"><div class="supava">${ico("info")}</div><div><h2 style="margin:0">${T("sup.title")}</h2><small>${T("sup.sub2")}</small></div></div>
    <div class="suplist" id="supList"></div>
    <div class="supform"><textarea id="supText" rows="3" maxlength="2000" placeholder="${esc(t("sup.ph"))}"></textarea>
      <div class="supbar"><label class="supchk"><input type="checkbox" id="supRep" ${first ? "checked" : ""}> ${T("sup.attach")}</label>
        <span style="flex:1"></span><button class="btn ghost" onclick="closeSupport()">${T("sup.close")}</button>
        <button class="btn brand" id="supSend" onclick="sendSupport()">${ico("check")}${T("sup.send")}</button></div></div>`, true);
  drawSupport(r.msgs);
  const ta = $("#supText"); ta.focus();
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); sendSupport(); } });
  supOpen = true; clearInterval(supTimer);
  supTimer = setInterval(async () => {
    if (!$("#supList") || !$("#modal").classList.contains("open")) { supOpen = false; return clearInterval(supTimer); }
    const p = await call("support_chat", true).catch(() => null);
    if (p) drawSupport(p.msgs);
  }, 8000);
  call("support_chat", true).then(p => p && drawSupport(p.msgs)).catch(() => {});
}
function closeSupport() { supOpen = false; clearInterval(supTimer); closeModal(); }
async function sendSupport() {
  const ta = $("#supText"), btn = $("#supSend"); if (!ta || btn.disabled) return;
  const text = ta.value.trim(); if (!text) return ta.focus();
  btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${T("sup.sending")}`;
  try {
    const r = await call("support_send", text, $("#supRep").checked);
    if (r) { ta.value = ""; $("#supRep").checked = false; drawSupport(r.msgs); $("#supList").scrollTop = 1e9; }
  } finally { btn.disabled = false; btn.innerHTML = `${ico("check")}${T("sup.send")}`; ta.focus(); }
}
function onSupport(d) {
  if (supOpen && $("#supList")) { drawSupport(d.msgs); return; }
  S.supUnread = d.unread || 0; renderChrome();
  if (d.new) {
    const el = document.createElement("div"); el.className = "task ok"; el.style.cursor = "pointer";
    el.innerHTML = `<b>${ico("info")}${esc(t("sup.reply"))}</b><small>${esc(t("sup.reply_sub"))}</small>`;
    el.onclick = () => { el.remove(); openSupport(); };
    $("#tasks").appendChild(el); setTimeout(() => el.remove(), 15000);
  }
}
function supChip() {
  return S.supUnread ? `<div class="chip" style="cursor:pointer" onclick="openSupport()">${ico("info")}${T("sup.chip", {n: S.supUnread})}</div>` : "";
}

/* Discord switch: saves at once and tells whether Discord accepted the status */
async function toggleDiscord(el) {
  const on = !el.classList.contains("on");
  el.classList.toggle("on", on);
  S.settings.discord = on;
  const r = await call("set_discord", on);
  if (!on) return toast(t("dc.off"), "ok");
  if (r && r.ok) toast(t("dc.on"), "ok");
  else toast(t(r && r.error === "not_running" ? "dc.no_app" : "dc.fail", {err: (r && r.error) || "?"}), "error");
}

/* F11 — fullscreen launcher window (pywebview doesn't bind it by itself) */
document.addEventListener("keydown", e => {
  if (e.key === "F11") { e.preventDefault(); call("toggle_fullscreen").catch(() => {}); }
});
