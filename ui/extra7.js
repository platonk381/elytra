/* Elytra 0.11 — friends online: friend codes, presence, invites (encrypted, through ntfy.sh) */
S.friends = null;
const LOADER_NAMES = {fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", vanilla: "Vanilla"};

async function loadFriends() {
  const r = await call("friends_get").catch(() => null);
  if (r) { S.friends = r; renderChrome(); drawFriends(); }
}
function friendsOnline() { return (S.friends?.friends || []).filter(f => f.online); }

/* top bar button with the number of friends online */
function friendsChip() {
  const on = friendsOnline().length, req = (S.friends?.requests || []).length;
  return `<button class="chip frchip" onclick="openFriends()" title="${T("fr2.title")}">${ico("users")}<span>${on ? T("fr2.online_n", {n: on}) : T("fr2.title")}</span>${req ? `<b class="frbadge">${req}</b>` : ""}</button>`;
}

function frStatus(f) {
  if (!f.online) return f.seen ? T("fr2.seen", {when: agoText(f.seen)}) : T("fr2.offline");
  if (f.st === "playing") return T("fr2.playing", {inst: f.inst, ver: `${LOADER_NAMES[f.loader] || f.loader} ${f.mc}`});
  return T("fr2.in_launcher");
}
function agoText(ts) {
  const m = Math.max(1, Math.round((Date.now() / 1000 - ts) / 60));
  if (m < 60) return t("fr2.min", {n: m});
  const h = Math.round(m / 60);
  return h < 24 ? t("fr2.hours", {n: h}) : t("fr2.days", {n: Math.round(h / 24)});
}
function frAvatar(f, size = 40) {
  const u = esc(skinUrl(f.name));
  return `<span class="avatar face fravatar ${f.online ? (f.st === "playing" ? "play" : "on") : ""}" style="--s:${size}px;background-image:url('${u}'),url('${u}')"></span>`;
}

function friendRows() {
  const fr = S.friends; if (!fr) return `<div class="frempty"><span class="spin"></span></div>`;
  const req = fr.requests.map(r => `<div class="frrow req">${frAvatar({name: r.name})}<div class="frmeta"><b>${esc(streamer() ? mask(r.name) : r.name || r.code)}</b><small>${T("fr2.wants")}</small></div>
      <button class="btn brand" onclick='frAccept(${jsArg(r.code)})'>${ico("check")}${T("fr2.accept")}</button>
      <button class="btn icon ghost" title="${T("fr2.decline")}" onclick='frDecline(${jsArg(r.code)})'>${ico("x")}</button></div>`).join("");
  const list = fr.friends.map(f => `<div class="frrow">${frAvatar(f)}<div class="frmeta"><b>${esc(streamer() ? mask(f.name) : f.name)}</b><small class="${f.online ? (f.st === "playing" ? "play" : "on") : ""}">${esc(frStatus(f))}</small></div>
      ${f.online && f.join ? `<button class="btn brand" onclick='frJoin(${jsArg(f.code)})'>${ico("play")}${T("fr2.join")}</button>` : ""}
      <button class="btn" onclick='frInvite(${jsArg(f.code)}, this)'>${ico("send")}${T("fr2.invite")}</button>
      <button class="btn icon ghost" title="${T("fr2.remove")}" onclick='frRemove(${jsArg(f.code)}, ${jsArg(f.name)})'>${ico("trash")}</button></div>`).join("");
  if (!req && !list) return `<div class="frempty">${ico("users")}<b>${T("fr2.empty")}</b><p>${T("fr2.empty_sub")}</p></div>`;
  return req + list;
}
function drawFriends() {
  const box = $("#frList"); if (box) box.innerHTML = friendRows();
  const inv = $("#frInv"); if (inv && S.friends) inv.classList.toggle("on", S.friends.invisible);
  const my = $("#frMy"); if (my && S.friends) my.textContent = streamer() ? "••••-••••" : S.friends.code;
}

function openFriends() {
  const code = S.friends?.code || "…";
  modal(`<div class="doc-head"><div class="di">${ico("users")}</div><div><h3 style="margin:0">${T("fr2.title")}</h3><small>${T("fr2.sub")}</small></div>
      <button class="btn icon ghost" style="margin-left:auto" onclick="closeModal()">${ico("x")}</button></div>
    <div class="frcode"><div><small>${T("fr2.your_code")}</small><code id="frMy">${esc(streamer() ? "••••-••••" : code)}</code></div>
      <button class="btn" onclick="S.friends && copyText(S.friends.code)">${ico("copy")}${T("sh.copy")}</button></div>
    <div class="fradd"><input class="input" id="frCode" maxlength="9" placeholder="${T("fr2.code_ph")}" autocomplete="off">
      <button class="btn brand" id="frAddBtn" onclick="frAdd()">${ico("plus")}${T("fr2.add")}</button></div>
    <div class="frlist" id="frList">${friendRows()}</div>
    <div class="frfoot"><button class="switch ${S.friends?.invisible ? "on" : ""}" id="frInv" onclick="frInvisible(this)"></button><div><b>${T("fr2.invisible")}</b><small>${T("fr2.invisible_sub")}</small></div></div>`, true);
  const inp = $("#frCode");
  inp.addEventListener("input", () => { let v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); inp.value = v.length > 4 ? v.slice(0, 4) + "-" + v.slice(4) : v; });
  inp.addEventListener("keydown", e => { if (e.key === "Enter") frAdd(); });
  loadFriends();
}
async function frAdd() {
  const inp = $("#frCode"), btn = $("#frAddBtn"); if (!inp || !inp.value.trim()) return inp?.focus();
  btn.disabled = true;
  try {
    const r = await call("friend_add", inp.value);
    if (r) { S.friends = r; inp.value = ""; drawFriends(); renderChrome(); toast(t("fr2.added"), "ok"); }
  } finally { btn.disabled = false; }
}
async function frAccept(code) { const r = await call("friend_add", code); if (r) { S.friends = r; drawFriends(); renderChrome(); toast(t("fr2.added"), "ok"); } }
async function frDecline(code) { const r = await call("friend_decline", code); if (r) { S.friends = r; drawFriends(); renderChrome(); } }
async function frRemove(code, name) {
  if (!confirm(t("fr2.remove_q", {name}))) return;
  const r = await call("friend_remove", code); if (r) { S.friends = r; drawFriends(); renderChrome(); }
}
async function frInvite(code, btn) {
  if (btn) btn.disabled = true;
  const ok = await call("friend_invite", code).catch(() => null);
  if (btn) btn.disabled = false;
  if (ok) toast(t("fr2.invited"), "ok");
}
async function frInvisible(el) {
  const on = !el.classList.contains("on"); el.classList.toggle("on", on);
  const r = await call("friends_invisible", on); if (r) { S.friends = r; renderChrome(); }
}

/* join a friend who opened their world with "Play with a friend" */
function frJoin(code) {
  const f = (S.friends?.friends || []).find(x => x.code === code); if (!f || !f.join) return;
  joinFriendWorld(f.name, f.join, f.mc, f.loader);
}
function joinFriendWorld(name, addr, mc, loader) {
  joinByAddress();
  const a = $("#jAddr"); if (a) a.value = addr;
  const sel = $("#jInst");
  if (sel) {
    const match = S.instances.find(i => i.status === "ready" && i.mc === mc && i.loader === loader) || S.instances.find(i => i.status === "ready" && i.mc === mc);
    if (match) sel.value = match.id;
    if (!match && mc) {
      const p = document.createElement("p"); p.className = "hint";
      p.innerHTML = `${ico("alert")}${esc(t("fr2.need_inst", {ver: `${LOADER_NAMES[loader] || loader} ${mc}`}))}`;
      sel.parentNode.after(p);
    }
  }
}

/* events from Python */
function onFriendsEvent(type, d) {
  if (type === "friends") {
    const before = new Set(friendsOnline().map(f => f.code));
    S.friends = d; renderChrome(); drawFriends();
    friendsOnline().filter(f => S._frSeeded && !before.has(f.code)).forEach(f => toast(t("fr2.came_online", {name: f.name}), "ok"));
    S._frSeeded = true;
  } else if (type === "friend_request") {
    actionToast(t("fr2.req_toast", {name: d.name || d.code}), t("fr2.open"), openFriends);
    loadFriends();
  } else if (type === "friend_invite") {
    const what = d.inst ? ` · ${d.inst} (${LOADER_NAMES[d.loader] || d.loader} ${d.mc})` : "";
    actionToast(t("fr2.invite_toast", {name: d.name}) + what, d.join ? t("fr2.join") : t("fr2.open"),
      () => d.join ? joinFriendWorld(d.name, d.join, d.mc, d.loader) : openFriends(), 30000);
  }
}
function actionToast(text, btnText, fn, ms = 15000) {
  const el = document.createElement("div"); el.className = "task ok frtoast";
  el.innerHTML = `<b>${ico("users")}${esc(text)}</b><button class="btn brand">${esc(btnText)}</button>`;
  el.querySelector("button").onclick = () => { el.remove(); fn(); };
  $("#tasks").appendChild(el); setTimeout(() => el.remove(), ms);
}
setTimeout(loadFriends, 1500);
