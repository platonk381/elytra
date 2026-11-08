/* Elytra 0.10 — Elytra Wrapped (monthly recap) and Elytra Flight (mini-game while things install) */

/* ================= home row ================= */
function funRow() {
  const g = S.game || {best: 0};
  const mon = new Intl.DateTimeFormat((S.settings.lang || "en"), {month: "long"}).format(new Date());
  return `<div class="funrow">
    <button class="funcard wr" onclick="openWrapped()"><span class="fe">🎁</span><div><b>${T("wr.home_title")}</b><small>${T("wr.home_sub", {month: mon})}</small></div>${ico("arrow")}</button>
    <button class="funcard fl" onclick="openFlight()"><span class="fe">🪽</span><div><b>Elytra Flight</b><small>${g.best ? T("fl.home_best", {n: g.best}) : T("fl.home_sub")}</small></div>${ico("arrow")}</button>
  </div>`;
}

/* ================= Wrapped ================= */
const WR = {data: null, slides: [], i: 0, timer: null, paused: false};
const fmtHM = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? t("wr.hm", {h, m}) : t("wr.m", {m}); };
const nfmt = n => new Intl.NumberFormat((S.settings.lang || "en")).format(n);
const wrPretty = id => String(id || "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
const TYPE_EMOJI = {miner: "⛏️", traveler: "🧭", warrior: "⚔️", pilot: "🪽", daredevil: "💀", night_owl: "🦉", marathon: "🏃", builder: "🔨", explorer: "🌍"};
const WR_BG = ["#7c3aed,#db2777", "#0ea5e9,#6366f1", "#16a34a,#0d9488", "#f59e0b,#ef4444", "#334155,#7c3aed", "#e11d48,#7c2d12", "#2563eb,#0f766e", "#9333ea,#f59e0b", "#0f172a,#7c3aed"];

function periodLabel(p) {
  if (p === "all") return t("wr.all_time");
  const [y, m] = p.split("-").map(Number);
  return new Intl.DateTimeFormat((S.settings.lang || "en"), {month: "long", year: "numeric"}).format(new Date(y, m - 1, 1));
}

async function openWrapped(period) {
  let d;
  try { d = await call("get_wrapped", period || null); } catch { return; }
  // nothing logged yet this month → show everything so far instead of an empty story
  if (!period && !d.seconds && !d.sessions) { try { d = await call("get_wrapped", "all"); d.fallback = true; } catch { return; } }
  WR.data = d; WR.slides = buildSlides(d); WR.i = 0;
  let el = $("#wrap");
  if (!el) { el = document.createElement("div"); el.id = "wrap"; document.body.appendChild(el); }
  el.innerHTML = `<div class="wr-bars">${WR.slides.map((_, n) => `<i data-n="${n}"><b></b></i>`).join("")}</div>
    <button class="wr-x" onclick="closeWrapped()">${ico("x")}</button>
    <div class="wr-stage" id="wrStage"></div>
    <div class="wr-nav"><button class="wr-prev" onclick="wrGo(-1)"></button><button class="wr-next" onclick="wrGo(1)"></button></div>`;
  el.classList.add("on");
  wrShow();
}
function closeWrapped() { clearTimeout(WR.timer); const el = $("#wrap"); if (el) el.classList.remove("on"); }
function wrGo(d) {
  const n = WR.i + d;
  if (n < 0) return;
  if (n >= WR.slides.length) return;
  WR.i = n; wrShow();
}
function wrShow() {
  clearTimeout(WR.timer);
  const s = WR.slides[WR.i], st = $("#wrStage");
  st.style.background = `linear-gradient(160deg,${WR_BG[WR.i % WR_BG.length]})`;
  st.innerHTML = `<div class="wr-slide">${s.html}</div>`;
  document.querySelectorAll(".wr-bars i").forEach((b, n) => { b.className = n < WR.i ? "done" : n === WR.i ? "cur" : ""; });
  const last = WR.i === WR.slides.length - 1;
  const bar = document.querySelector(".wr-bars i.cur b");
  if (bar) bar.style.animationDuration = last ? "0s" : "7s";
  st.querySelectorAll("[data-count]").forEach(countUp);
  if (s.after) s.after();
  if (!last) WR.timer = setTimeout(() => wrGo(1), 7000);
}
function countUp(el) {
  const target = +el.dataset.count, dec = +(el.dataset.dec || 0), t0 = performance.now(), dur = 1300;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), v = target * (1 - Math.pow(1 - k, 3));
    el.textContent = dec ? v.toFixed(dec) : nfmt(Math.round(v));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const big = (n, dec = 0) => `<span class="wr-big" data-count="${n}" data-dec="${dec}">0</span>`;

function buildSlides(d) {
  const S_ = [], st = d.stats;
  S_.push({html: `<div class="wr-kicker">Elytra Wrapped</div><h1 class="wr-h">${T("wr.intro", {period: periodLabel(d.period)})}</h1>
    ${d.fallback ? `<p class="wr-p">${T("wr.fallback")}</p>` : `<p class="wr-p">${T("wr.intro_sub")}</p>`}<div class="wr-wings">🪽</div>`});
  if (!d.seconds && !d.sessions && !st.blocks && !st.km) {
    S_.push({html: `<h2 class="wr-h2">${T("wr.empty")}</h2><p class="wr-p">${T("wr.empty_sub")}</p>`});
    return S_;
  }
  if (d.seconds) {
    const films = Math.round(d.seconds / 7200);
    S_.push({html: `<div class="wr-kicker">${T("wr.time_k")}</div><div class="wr-num">${big(Math.floor(d.seconds / 3600))}<span class="wr-unit">${T("wr.hours")}</span></div>
      <p class="wr-p">${T("wr.time_sub", {time: fmtHM(d.seconds), n: d.sessions})}</p>
      ${films >= 1 ? `<p class="wr-fun">🎬 ${T("wr.films", {n: films})}</p>` : ""}`});
  }
  if (d.fav) {
    const i = S.instances.find(x => x.id === d.fav.id) || d.fav;
    S_.push({html: `<div class="wr-kicker">${T("wr.fav_k")}</div><div class="wr-fav">${icon(i.icon, i.name)}</div>
      <h2 class="wr-h2">${esc(d.fav.name)}</h2><p class="wr-p">${esc(loaderName(d.fav.loader))} ${esc(d.fav.mc)}</p>
      <p class="wr-fun">${T("wr.fav_sub", {time: fmtHM(d.fav.seconds), pct: Math.round(d.fav.share * 100)})}</p>`});
  }
  if (st.km >= 0.1) {
    S_.push({html: `<div class="wr-kicker">${T("wr.km_k")}</div><div class="wr-num">${big(st.km, st.km < 100 ? 1 : 0)}<span class="wr-unit">${T("u.km")}</span></div>
      ${st.elytra_km >= 0.1 ? `<p class="wr-p">🪽 ${T("wr.elytra", {n: st.elytra_km})}</p>` : ""}
      <p class="wr-fun">${st.km >= 42.2 ? `🏃 ${T("wr.marathons", {n: Math.round(st.km / 42.2 * 10) / 10})}` : `🚶 ${T("wr.steps", {n: nfmt(Math.round(st.km * 1300))})}`}</p>`});
  }
  if (st.blocks) {
    const tm = d.top_mined[0];
    S_.push({html: `<div class="wr-kicker">${T("wr.mine_k")}</div><div class="wr-num">${big(st.blocks)}<span class="wr-unit">${T("wr.blocks")}</span></div>
      ${st.diamonds ? `<p class="wr-p">💎 ${T("wr.diamonds", {n: nfmt(st.diamonds)})}</p>` : ""}
      ${tm ? `<p class="wr-fun">${T("wr.top_block", {name: wrPretty(tm[0]), n: nfmt(tm[1])})}</p>` : ""}`});
  }
  if (st.mob_kills || st.deaths) {
    S_.push({html: `<div class="wr-kicker">${T("wr.fight_k")}</div>
      <div class="wr-duo"><div>${big(st.mob_kills)}<small>${T("wr.mobs")}</small></div><div>${big(st.deaths)}<small>${T("wr.deaths")}</small></div></div>
      ${d.nemesis ? `<p class="wr-fun">${T("wr.nemesis", {mob: wrPretty(d.nemesis)})}</p>` : ""}
      ${st.creepers ? `<p class="wr-p">💥 ${T("wr.creepers", {n: nfmt(st.creepers)})}</p>` : ""}`});
  }
  if (d.days) {
    S_.push({html: `<div class="wr-kicker">${T("wr.rhythm_k")}</div>
      <div class="wr-trio"><div>${big(d.days)}<small>${T("wr.days")}</small></div><div>${big(d.streak)}<small>${T("wr.streak")}</small></div>
      <div><span class="wr-big">${fmtHM(d.longest)}</span><small>${T("wr.longest")}</small></div></div>
      ${d.peak_hour != null ? `<p class="wr-fun">${d.night_share > .4 ? "🌙" : "☀️"} ${T("wr.peak", {h: String(d.peak_hour).padStart(2, "0") + ":00"})}</p>` : ""}`});
  }
  S_.push({html: `<div class="wr-kicker">${T("wr.type_k")}</div><div class="wr-emoji">${TYPE_EMOJI[d.type]}</div>
    <h1 class="wr-h">${T("wr.t_" + d.type)}</h1><p class="wr-p">${T("wr.t_" + d.type + "_d")}</p>`});
  S_.push({html: `<div class="wr-final"><img id="wrCard" alt=""><div class="wr-btns">
      <button class="btn brand big" onclick="saveWrapped()">${ico("download")}${T("wr.save")}</button>
      <button class="btn big" onclick="WR.i=0;wrShow()">${ico("refresh")}${T("wr.again")}</button></div>
      <div class="wr-periods">${["", "all", ...(d.months || []).filter(m => m !== d.period).slice(0, 4)].map(p =>
        `<button class="chip" onclick="openWrapped('${p}')">${p === "" ? T("wr.this_month") : esc(periodLabel(p))}</button>`).join("")}</div></div>`,
    after: () => { $("#wrCard").src = drawCard(d).toDataURL("image/png"); }});
  return S_;
}

/* the shareable 1080×1920 card, drawn by hand on a canvas */
function drawCard(d) {
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
  const x = c.getContext("2d"), font = getComputedStyle(document.body).fontFamily, st = d.stats;
  const g = x.createLinearGradient(0, 0, 1080, 1920); g.addColorStop(0, "#1e1238"); g.addColorStop(.55, "#3b0f4f"); g.addColorStop(1, "#0b1530");
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
  [[150, 260, 520, "rgba(139,92,246,.55)"], [950, 900, 560, "rgba(236,72,153,.4)"], [300, 1700, 520, "rgba(34,211,238,.28)"]].forEach(([cx, cy, r, col]) => {
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = rg; x.fillRect(0, 0, 1080, 1920);
  });
  const txt = (s, X, Y, size, weight = 800, color = "#fff", align = "left") => { x.font = `${weight} ${size}px ${font}`; x.fillStyle = color; x.textAlign = align; x.fillText(s, X, Y); };
  const fit = (s, max, size, weight = 800) => { x.font = `${weight} ${size}px ${font}`; while (x.measureText(s).width > max && size > 20) { size -= 2; x.font = `${weight} ${size}px ${font}`; } return size; };
  const rr = (X, Y, W, H, r, fill) => { x.beginPath(); x.roundRect(X, Y, W, H, r); x.fillStyle = fill; x.fill(); };
  txt("🪽 Elytra Wrapped", 90, 170, 46, 800, "#e9d5ff");
  txt(periodLabel(d.period), 90, 270, fit(periodLabel(d.period), 900, 92), 900);
  txt(t("wr.card_time"), 90, 410, 40, 600, "#d8ccf5");
  const hrs = Math.floor(d.seconds / 3600);
  txt(nfmt(hrs), 90, 590, 210, 900);
  x.font = `900 210px ${font}`; const w = x.measureText(nfmt(hrs)).width;
  txt(t("wr.hours"), 110 + w, 590, 64, 700, "#f0abfc");
  const tiles = [["🧭", st.km, t("u.km")], ["⛏️", st.blocks, t("wr.blocks")], ["💎", st.diamonds, t("wr.diamonds_s")],
    ["⚔️", st.mob_kills, t("wr.mobs")], ["💀", st.deaths, t("wr.deaths")], ["🎮", d.sessions, t("wr.sessions")]];
  tiles.forEach(([e, v, l], n) => {
    const X = 90 + (n % 2) * 460, Y = 680 + Math.floor(n / 2) * 230;
    rr(X, Y, 430, 200, 32, "rgba(255,255,255,.09)");
    txt(e, X + 36, Y + 82, 54, 400);
    txt(nfmt(v), X + 36, Y + 152, fit(nfmt(v), 360, 64, 900), 900);
    txt(l, X + 394, Y + 82, 30, 600, "#cbbdf0", "right");
  });
  rr(90, 1400, 900, 210, 36, "rgba(255,255,255,.12)");
  txt(TYPE_EMOJI[d.type], 140, 1540, 100, 400);
  txt(t("wr.type_k"), 290, 1475, 32, 600, "#e9d5ff");
  const tn = t("wr.t_" + d.type); txt(tn, 290, 1555, fit(tn, 660, 64, 900), 900);
  if (d.fav) { const s = `★ ${d.fav.name}`; txt(s, 90, 1700, fit(s, 900, 44, 700), 700, "#fde68a"); }
  txt("Elytra · Minecraft launcher", 540, 1830, 32, 600, "rgba(255,255,255,.6)", "center");
  return c;
}
async function saveWrapped() {
  const img = $("#wrCard"); if (!img) return;
  try { await call("save_image", img.src, `Elytra-Wrapped-${WR.data.period}`); toast(t("wr.saved"), "ok"); } catch {}
}
document.addEventListener("keydown", e => {
  if (!$("#wrap")?.classList.contains("on")) return;
  if (e.key === "Escape") closeWrapped();
  else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); wrGo(1); }
  else if (e.key === "ArrowLeft") wrGo(-1);
}, true);

/* ================= Elytra Flight ================= */
const FL = {on: false};
function openFlight() {
  let el = $("#flight");
  if (!el) {
    el = document.createElement("div"); el.id = "flight";
    el.innerHTML = `<div class="fl-box"><div class="fl-top"><b>🪽 Elytra Flight</b><span id="flTask"></span><span class="spacer"></span>
      <span class="fl-best">${T("fl.best")}: <b id="flBest">0</b></span><button class="btn icon ghost" onclick="closeFlight()">${ico("x")}</button></div>
      <canvas id="flCv" width="960" height="540"></canvas><div class="fl-hint">${T("fl.hint")}</div></div>`;
    document.body.appendChild(el);
    const cv = $("#flCv");
    const press = on => e => { if (e.button !== undefined && e.button !== 0) return; e.preventDefault(); flInput(on); };
    cv.addEventListener("mousedown", press(true)); window.addEventListener("mouseup", () => flInput(false));
    cv.addEventListener("touchstart", press(true), {passive: false}); cv.addEventListener("touchend", press(false));
  }
  el.classList.add("on"); FL.on = true; FL.gen = (FL.gen || 0) + 1;
  $("#flBest").textContent = (S.game || {}).best || 0;
  flReset(); FL.state = "ready"; flLoop.last = performance.now(); const gen = FL.gen; requestAnimationFrame(n => flLoop(n, gen)); flTaskLine();
}
function closeFlight() { FL.on = false; const el = $("#flight"); if (el) el.classList.remove("on"); }
document.addEventListener("keydown", e => {
  if (!FL.on) return;
  if (e.key === "Escape") { closeFlight(); return; }
  if ([" ", "ArrowUp", "w", "W"].includes(e.key)) { e.preventDefault(); if (!e.repeat) flInput(true); }
}, true);
document.addEventListener("keyup", e => { if (FL.on && [" ", "ArrowUp", "w", "W"].includes(e.key)) flInput(false); }, true);

function flInput(down) {
  if (!FL.on) return;
  if (down && FL.state === "ready") FL.state = "play";
  else if (down && FL.state === "over" && performance.now() - FL.overAt > 600) { flReset(); FL.state = "play"; }
  FL.thrust = down;
}
function flReset() {
  Object.assign(FL, {y: 250, vy: 0, x: 200, dist: 0, speed: 4.2, score: 0, pillars: [], rings: [], parts: [], next: 520, thrust: false, newBest: false, tick: 0});
}
const FL_W = 960, FL_H = 540, GROUND = 500;
// tiny procedural pixel textures (original art, generated at start)
const FL_TEX = (() => {
  const mk = (pal, seed) => {
    const c = document.createElement("canvas"); c.width = c.height = 16; const x = c.getContext("2d"); let s = seed;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { s = (s * 9301 + 49297) % 233280; x.fillStyle = pal[Math.floor(s / 233280 * pal.length)]; x.fillRect(i, j, 1, 1); }
    return c;
  };
  return {stone: mk(["#7b7b80", "#8a8a90", "#6c6c72", "#95959b"], 7), obsidian: mk(["#1b1430", "#251a40", "#120d22", "#3a2a5c"], 3),
    grass: mk(["#4c9a3a", "#58ad44", "#3f8a31"], 5), dirt: mk(["#7a5534", "#6b4a2d", "#86603b"], 9)};
})();

function flSpawn() {
  const gap = Math.max(150, 215 - FL.score * 1.6), top = 60 + Math.random() * (GROUND - 120 - gap);
  const tex = FL.score > 25 && Math.random() < .5 ? "obsidian" : "stone";
  FL.pillars.push({x: FL_W + 40, w: 64, top, gap, tex, passed: false});
  if (Math.random() < .55) FL.rings.push({x: FL_W + 40 + 32, y: top + gap / 2, got: false});
}
function flLoop(now, gen) {
  if (!FL.on || gen !== FL.gen) return;
  const dt = Math.min(2.2, (now - flLoop.last) / 16.67); flLoop.last = now;
  if (FL.state === "play") flStep(dt);
  flDraw();
  requestAnimationFrame(n => flLoop(n, gen));
}
function flStep(dt) {
  FL.tick += dt;
  FL.vy += (FL.thrust ? -0.55 : 0.32) * dt;
  FL.vy = Math.max(-7, Math.min(8, FL.vy));
  FL.y += FL.vy * dt;
  FL.speed = Math.min(9, 4.2 + FL.score * 0.06);
  const dx = FL.speed * dt;
  FL.dist += dx;
  FL.next -= dx;
  if (FL.next <= 0) { flSpawn(); FL.next = 300 + Math.random() * 90 - Math.min(60, FL.score); }
  if (FL.thrust && Math.random() < .6) FL.parts.push({x: FL.x - 18, y: FL.y + 6, vx: -2 - Math.random() * 2, vy: (Math.random() - .5) * 1.5, life: 26, col: Math.random() < .5 ? "#fbbf24" : "#f472b6"});
  FL.parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }); FL.parts = FL.parts.filter(p => p.life > 0);
  const hit = (ax, ay, aw, ah) => FL.x + 26 > ax && FL.x - 24 < ax + aw && FL.y + 13 > ay && FL.y - 13 < ay + ah;
  for (const p of FL.pillars) {
    p.x -= dx;
    if (!p.passed && p.x + p.w < FL.x) { p.passed = true; FL.score++; }
    if (hit(p.x, 0, p.w, p.top) || hit(p.x, p.top + p.gap, p.w, GROUND - p.top - p.gap)) return flOver();
  }
  for (const r of FL.rings) {
    r.x -= dx;
    if (!r.got && Math.abs(r.x - FL.x) < 22 && Math.abs(r.y - FL.y) < 30) { r.got = true; FL.score += 2; for (let i = 0; i < 14; i++) FL.parts.push({x: r.x, y: r.y, vx: (Math.random() - .5) * 6, vy: (Math.random() - .5) * 6, life: 30, col: "#fde047"}); }
  }
  FL.pillars = FL.pillars.filter(p => p.x > -100); FL.rings = FL.rings.filter(r => r.x > -60 && !r.got);
  if (FL.y > GROUND - 10 || FL.y < 10) flOver();
}
async function flOver() {
  FL.state = "over"; FL.overAt = performance.now(); FL.thrust = false;
  for (let i = 0; i < 30; i++) FL.parts.push({x: FL.x, y: FL.y, vx: (Math.random() - .5) * 8, vy: (Math.random() - .5) * 8, life: 40, col: ["#a78bfa", "#f472b6", "#fff"][i % 3]});
  try {
    const r = await call("game_score", FL.score);
    S.game = {best: r.best, plays: r.plays}; FL.newBest = r.new && FL.score > 0;
    $("#flBest").textContent = r.best;
  } catch {}
}
function flDraw() {
  const cv = $("#flCv"); if (!cv) return;
  const x = cv.getContext("2d"); x.imageSmoothingEnabled = false;
  const night = Math.min(1, FL.score / 40);
  const sky = x.createLinearGradient(0, 0, 0, FL_H);
  sky.addColorStop(0, night > .5 ? "#120b2e" : "#5aa9ff"); sky.addColorStop(1, night > .5 ? "#3b1f6b" : "#c7e3ff");
  x.fillStyle = sky; x.fillRect(0, 0, FL_W, FL_H);
  if (night > .5) { x.fillStyle = "rgba(255,255,255,.8)"; for (let i = 0; i < 40; i++) x.fillRect((i * 137 - FL.dist * .05) % FL_W + (i * 137 - FL.dist * .05 < 0 ? FL_W : 0), (i * 61) % 300, 2, 2); }
  // pixel clouds and far hills (parallax)
  x.fillStyle = night > .5 ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.85)";
  for (let i = 0; i < 6; i++) { const cx = ((i * 230 - FL.dist * .3) % (FL_W + 200) + FL_W + 200) % (FL_W + 200) - 100, cy = 60 + (i * 47) % 140; x.fillRect(cx, cy, 96, 16); x.fillRect(cx + 16, cy - 16, 48, 16); }
  x.fillStyle = night > .5 ? "#24164a" : "#7fb9e8";
  for (let i = 0; i < 24; i++) { const hx = ((i * 64 - FL.dist * .15) % (FL_W + 64) + FL_W + 64) % (FL_W + 64) - 64, hh = 60 + ((i * 37) % 5) * 22; x.fillRect(hx, GROUND - hh, 64, hh); }
  // pillars
  for (const p of FL.pillars) {
    for (let yy = 0; yy < p.top; yy += 32) x.drawImage(FL_TEX[p.tex], p.x, p.top - 32 - yy, p.w / 2, 32), x.drawImage(FL_TEX[p.tex], p.x + p.w / 2, p.top - 32 - yy, p.w / 2, 32);
    for (let yy = p.top + p.gap; yy < GROUND; yy += 32) x.drawImage(FL_TEX[p.tex], p.x, yy, p.w / 2, 32), x.drawImage(FL_TEX[p.tex], p.x + p.w / 2, yy, p.w / 2, 32);
    x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(p.x + p.w - 6, 0, 6, p.top); x.fillRect(p.x + p.w - 6, p.top + p.gap, 6, GROUND - p.top - p.gap);
  }
  for (const r of FL.rings) { x.strokeStyle = "#fde047"; x.lineWidth = 6; x.beginPath(); x.ellipse(r.x, r.y, 10, 26, 0, 0, Math.PI * 2); x.stroke(); }
  // ground
  for (let gx = -((FL.dist) % 32); gx < FL_W; gx += 32) { x.drawImage(FL_TEX.grass, gx, GROUND, 32, 10); x.drawImage(FL_TEX.dirt, gx, GROUND + 10, 32, 40); }
  FL.parts.forEach(p => { x.fillStyle = p.col; x.globalAlpha = Math.max(0, p.life / 40); x.fillRect(p.x, p.y, 5, 5); }); x.globalAlpha = 1;
  // player: a little gliding figure with violet wings (original sprite)
  if (FL.state !== "over") {
    x.save(); x.translate(FL.x, FL.y); x.rotate(Math.max(-.5, Math.min(.6, FL.vy / 12))); x.scale(1.7, 1.7);
    const flap = FL.thrust ? Math.sin(FL.tick * .8) * 3 : 0;
    x.fillStyle = "#7c3aed"; x.fillRect(-18, -12 - flap, 22, 8); x.fillStyle = "#a78bfa"; x.fillRect(-16, -10 - flap, 18, 4);
    x.fillStyle = "#1b9e6b"; x.fillRect(-10, -4, 18, 8);          // body
    x.fillStyle = "#3b4a8c"; x.fillRect(-16, -2, 8, 6);           // legs
    x.fillStyle = "#e0b48a"; x.fillRect(8, -6, 10, 10);           // head
    x.fillStyle = "#4b2e1a"; x.fillRect(8, -6, 10, 3);            // hair
    x.fillStyle = "#1e1b4b"; x.fillRect(15, -2, 2, 2);            // eye
    x.fillStyle = "#6d28d9"; x.fillRect(-18, 2 + flap, 22, 7); x.fillStyle = "#c4b5fd"; x.fillRect(-14, 4 + flap, 14, 3);
    x.restore();
  }
  // HUD
  const tx = (s, X, Y, size, col = "#fff", al = "left") => { x.font = `800 ${size}px ${getComputedStyle(document.body).fontFamily}`; x.textAlign = al; x.fillStyle = "rgba(0,0,0,.35)"; x.fillText(s, X + 3, Y + 3); x.fillStyle = col; x.fillText(s, X, Y); };
  tx(String(FL.score), FL_W / 2, 70, 56, "#fff", "center");
  if (FL.state === "ready") { tx(t("fl.start"), FL_W / 2, 260, 34, "#fff", "center"); tx(t("fl.controls"), FL_W / 2, 300, 20, "#e9d5ff", "center"); }
  if (FL.state === "over") {
    x.fillStyle = "rgba(10,6,25,.55)"; x.fillRect(0, 0, FL_W, FL_H);
    tx(FL.newBest ? t("fl.new_best") : t("fl.over"), FL_W / 2, 220, 48, FL.newBest ? "#fde047" : "#fff", "center");
    tx(t("fl.score", {n: FL.score}), FL_W / 2, 275, 28, "#e9d5ff", "center");
    tx(t("fl.again"), FL_W / 2, 340, 22, "#c4b5fd", "center");
  }
}
// show what is installing while you play, and say when it's done
function flTaskLine() {
  const el = $("#flTask"); if (!el) return;
  const live = [...document.querySelectorAll("#tasks .task:not(.ok):not(.err)")][0];
  el.innerHTML = live ? `<span class="spin"></span>${esc(live.querySelector("b")?.textContent || "")} <i>${esc(live.querySelector("small")?.textContent || "")}</i>` : "";
}
const _renderTask = renderTask;
renderTask = function (tk) {
  _renderTask(tk);
  const el = document.getElementById("task" + tk.id);
  if (el && !tk.done && !el.querySelector(".tgame")) {
    const b = document.createElement("button"); b.className = "tgame"; b.innerHTML = `🪽 ${T("fl.while")}`; b.onclick = openFlight; el.appendChild(b);
  }
  if (FL.on) {
    flTaskLine();
    if (tk.done && !tk.error) { const el2 = $("#flTask"); if (el2) el2.innerHTML = `<span class="fl-done">✓ ${esc(tm(tk.title))} — ${T("fl.ready")}</span>`; }
  }
};
