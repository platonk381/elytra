/*
 * Elytra support bot — Cloudflare Worker.
 * Players write from the launcher (or to the bot in Telegram), messages arrive in your Telegram,
 * you press Reply on a message and the answer goes back to that player.
 *
 * Needs: KV binding  SUPPORT,  secrets  BOT_TOKEN  and  SECRET  (any password: letters, digits, _ or -).
 * After deploy open  https://<your-worker>.workers.dev/setup?key=<SECRET>  once.
 */

const MAX_TEXT = 2000, MAX_REPORT = 30000, KEEP = 60 * 60 * 24 * 60; // keep chats 60 days

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/tg" && req.method === "POST") return await telegram(req, env);
      if (url.pathname === "/api/send" && req.method === "POST") return await apiSend(req, env);
      if (url.pathname === "/api/poll") return await apiPoll(url, env);
      if (url.pathname === "/setup") return await setup(url, env);
      if (url.pathname === "/") return json({ok: true, service: "elytra-support"});
      return json({error: "not_found"}, 404);
    } catch (e) {
      return json({error: "server", detail: String(e && e.message || e)}, 500);
    }
  }
};

/* ---------- helpers ---------- */
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {"content-type": "application/json; charset=utf-8"}});
const html = s => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><body style="font:18px system-ui;background:#0b0a14;color:#eee;padding:30px;max-width:640px;margin:auto">${s}`, {headers: {"content-type": "text/html; charset=utf-8"}});
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const now = () => Math.floor(Date.now() / 1000);

async function tg(env, method, body, isForm) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, isForm
    ? {method: "POST", body}
    : {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
  return r.json();
}
const owner = env => env.SUPPORT.get("owner");
const say = (env, chat_id, text, extra = {}) => tg(env, "sendMessage", {chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra});

async function getTicket(env, tid) { return JSON.parse(await env.SUPPORT.get("t:" + tid) || "null"); }
async function putTicket(env, tid, t) { await env.SUPPORT.put("t:" + tid, JSON.stringify(t), {expirationTtl: KEEP}); }
async function mapMsg(env, msgId, target) { if (msgId) await env.SUPPORT.put("m:" + msgId, target, {expirationTtl: KEEP}); }

async function rateLimited(env, key, max, windowSec) {
  const k = "rl:" + key + ":" + Math.floor(now() / windowSec);
  const n = parseInt(await env.SUPPORT.get(k) || "0") + 1;
  if (n > max) return true;
  await env.SUPPORT.put(k, String(n), {expirationTtl: Math.max(60, windowSec * 2)});
  return false;
}

/* ---------- one-time setup ---------- */
async function setup(url, env) {
  if (!env.BOT_TOKEN || !env.SECRET || !env.SUPPORT) return html("❌ Не хватает настроек: нужны секреты <b>BOT_TOKEN</b>, <b>SECRET</b> и KV-привязка <b>SUPPORT</b>.");
  if (url.searchParams.get("key") !== env.SECRET) return html("❌ Неверный ключ. Открой <code>/setup?key=ТВОЙ_SECRET</code>.");
  const me = await tg(env, "getMe", {});
  if (!me.ok) return html("❌ Telegram не принял BOT_TOKEN: " + esc(me.description));
  const hook = await tg(env, "setWebhook", {url: `${url.origin}/tg`, secret_token: env.SECRET, allowed_updates: ["message"], drop_pending_updates: true});
  if (!hook.ok) return html("❌ Не получилось подключить бота: " + esc(hook.description));
  const link = `https://t.me/${me.result.username}?start=${encodeURIComponent(env.SECRET)}`;
  const o = await owner(env);
  return html(`<h2>✅ Бот @${esc(me.result.username)} подключён</h2>
    ${o ? "<p>Хозяин уже назначен. Всё работает 👍</p>" : `<p>Последний шаг — нажми и в Telegram нажми <b>Start</b>:</p><p><a style="display:inline-block;background:#8b5cf6;color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:700" href="${link}">Стать хозяином бота</a></p>`}
    <p style="color:#999">Адрес для лаунчера:<br><code>${esc(url.origin)}</code></p>`);
}

/* ---------- Telegram webhook ---------- */
async function telegram(req, env) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== env.SECRET) return new Response("forbidden", {status: 403});
  const upd = await req.json();
  const m = upd.message;
  if (!m || !m.chat || m.chat.type !== "private") return json({ok: true});
  const from = m.from || {}, text = m.text || m.caption || "";
  let me = await owner(env);

  if (text.startsWith("/start")) {
    const arg = text.split(" ")[1] || "";
    if (!me && arg === env.SECRET) {
      await env.SUPPORT.put("owner", String(m.chat.id));
      await say(env, m.chat.id, "✅ Теперь ты хозяин бота.\n\nСюда будут приходить сообщения из Elytra и от тех, кто напишет боту.\nЧтобы ответить — нажми на сообщение → <b>Ответить</b> (Reply) и напиши текст.");
      return json({ok: true});
    }
    if (String(m.chat.id) === me) { await say(env, m.chat.id, "Бот работает 👍 Отвечай через <b>Ответить</b> (Reply) на сообщение игрока."); return json({ok: true}); }
    await say(env, m.chat.id, "👋 Это поддержка лаунчера <b>Elytra</b>.\nОпиши проблему одним сообщением — разработчик ответит здесь же.");
    return json({ok: true});
  }
  if (!me) return json({ok: true});

  /* the owner answers */
  if (String(m.chat.id) === me) {
    const r = m.reply_to_message;
    const target = r && await env.SUPPORT.get("m:" + r.message_id);
    if (!target) { await say(env, me, "↩️ Чтобы ответить игроку, нажми на его сообщение → <b>Ответить</b> (Reply)."); return json({ok: true}); }
    if (target.startsWith("app:")) {
      if (!text) { await say(env, me, "В лаунчер можно отправить только текст."); return json({ok: true}); }
      const tid = target.slice(4), t = await getTicket(env, tid);
      if (!t) { await say(env, me, "⚠️ Этот чат устарел."); return json({ok: true}); }
      t.msgs.push({from: "dev", text: text.slice(0, MAX_TEXT), ts: now()});
      t.msgs = t.msgs.slice(-200);
      await putTicket(env, tid, t);
      await tg(env, "setMessageReaction", {chat_id: me, message_id: m.message_id, reaction: [{type: "emoji", emoji: "👍"}]});
    } else if (target.startsWith("tg:")) {
      const res = await tg(env, "copyMessage", {chat_id: target.slice(3), from_chat_id: me, message_id: m.message_id});
      if (res.ok) await tg(env, "setMessageReaction", {chat_id: me, message_id: m.message_id, reaction: [{type: "emoji", emoji: "👍"}]});
      else await say(env, me, "⚠️ Не доставлено: " + esc(res.description));
    }
    return json({ok: true});
  }

  /* a player writes to the bot in Telegram */
  if (await rateLimited(env, "tg" + m.chat.id, 30, 3600)) return json({ok: true});
  const who = `${esc([from.first_name, from.last_name].filter(Boolean).join(" ") || "?")}${from.username ? " @" + esc(from.username) : ""}`;
  const head = await say(env, me, `💬 <b>Telegram</b> · ${who}`);
  const fwd = await tg(env, "copyMessage", {chat_id: me, from_chat_id: m.chat.id, message_id: m.message_id});
  await mapMsg(env, head.result && head.result.message_id, "tg:" + m.chat.id);
  await mapMsg(env, fwd.result && fwd.result.message_id, "tg:" + m.chat.id);
  return json({ok: true});
}

/* ---------- launcher API ---------- */
const validId = s => typeof s === "string" && /^[a-f0-9]{16,64}$/.test(s);

async function apiSend(req, env) {
  const me = await owner(env);
  if (!me) return json({error: "not_ready"}, 503);
  const b = await req.json().catch(() => ({}));
  const {tid, key} = b;
  const text = String(b.text || "").trim().slice(0, MAX_TEXT);
  if (!validId(tid) || !validId(key) || !text) return json({error: "bad_request"}, 400);
  const ip = req.headers.get("cf-connecting-ip") || "?";
  if (await rateLimited(env, "ip" + ip, 40, 3600) || await rateLimited(env, "t" + tid, 20, 3600)) return json({error: "rate_limited"}, 429);

  let t = await getTicket(env, tid);
  if (t && t.key !== key) return json({error: "forbidden"}, 403);
  const fresh = !t;
  if (!t) t = {key, msgs: [], n: parseInt(await env.SUPPORT.get("count") || "0") + 1};
  if (fresh) await env.SUPPORT.put("count", String(t.n));
  t.msgs.push({from: "me", text, ts: now()});
  t.msgs = t.msgs.slice(-200);
  await putTicket(env, tid, t);

  const name = esc(String(b.name || "").slice(0, 32) || "Игрок"), ver = esc(String(b.version || "").slice(0, 16));
  const sent = await say(env, me, `🎮 <b>Elytra #${t.n}</b> · ${name}${ver ? " · v" + ver : ""}${fresh ? " · 🆕" : ""}\n\n${esc(text)}`);
  await mapMsg(env, sent.result && sent.result.message_id, "app:" + tid);

  const report = String(b.report || "").slice(0, MAX_REPORT);
  if (report) {
    const fd = new FormData();
    fd.append("chat_id", me);
    fd.append("document", new Blob([report], {type: "text/plain"}), `elytra-report-${t.n}.txt`);
    fd.append("caption", `Отчёт #${t.n}`);
    if (sent.result) fd.append("reply_parameters", JSON.stringify({message_id: sent.result.message_id}));
    const doc = await tg(env, "sendDocument", fd, true);
    await mapMsg(env, doc.result && doc.result.message_id, "app:" + tid);
  }
  return json({ok: true, msgs: t.msgs});
}

async function apiPoll(url, env) {
  const tid = url.searchParams.get("tid"), key = url.searchParams.get("key");
  if (!validId(tid) || !validId(key)) return json({error: "bad_request"}, 400);
  const t = await getTicket(env, tid);
  if (!t) return json({ok: true, msgs: []});
  if (t.key !== key) return json({error: "forbidden"}, 403);
  return json({ok: true, msgs: t.msgs});
}
