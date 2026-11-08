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
      <button class="btn ghost" onclick="reportProblem()">${ico("info")}${T("sup.btn")}</button>
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
