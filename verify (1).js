// Netlify Function — Lapa X sunucusu
// Netlify > Site settings > Environment variables:ADMİN_İD=7015341135
//   BOT_TOKEN        Telegram bot tokeni (bot, kanalda YÖNETİCİ olmalı)
//   CHANNEL          opsiyonel, varsayılan @lapata_coin
//   DAILY_CODES      (yedek) günlük şifreler: 2026-11-18=KELIME1,2026-11-19=KELIME2  (tarih: Türkiye saati)
//   Asıl yöntem: Firebase konsolunda codes > 2026-11-18 = KELIME yaz (yeniden yayın gerekmez)
//   DAILY_REWARD     opsiyonel, şifre ödülü (varsayılan 25000)
//   FIREBASE_URL     Realtime Database adresi, örn: https://xxx-default-rtdb.firebaseio.com
//   FIREBASE_SECRET  Firebase "Database secret"
const crypto = require("crypto");

const BOT = process.env.BOT_TOKEN;
const CHANNEL = process.env.CHANNEL || "@lapata_coin";
const FB = (process.env.FIREBASE_URL || "").replace(/\/$/, "");
const FBS = process.env.FIREBASE_SECRET || "";
const REWARD = Number(process.env.DAILY_REWARD) || 25000;
const H = { "Content-Type": "application/json" };
const out = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });

async function fb(method, path, query, body) {
  const q = (query ? query + "&" : "") + "auth=" + encodeURIComponent(FBS);
  const r = await fetch(`${FB}/${path}.json?${q}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error("firebase " + r.status);
  return r.json();
}

function checkInitData(initData) {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  p.delete("hash");
  if (!hash) return null;
  const str = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + "=" + v).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT).digest();
  const calc = crypto.createHmac("sha256", secret).update(str).digest("hex");
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date") || 0) > 86400) return null;
  try { return JSON.parse(p.get("user")); } catch (e) { return null; }
}

const norm = s => String(s || "").toLowerCase().replace(/\s+/g, "");
const sha = s => crypto.createHash("sha256").update(norm(s)).digest();
const clean = (s, n) => String(s || "").replace(/[<>&"'`\u0000-\u001f]/g, "").trim().slice(0, n);
const trDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

function envCode(day) {
  for (const part of String(process.env.DAILY_CODES || "").split(/[,;\n]/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === day) return part.slice(i + 1).trim();
  }
  return "";
}
// Önce Firebase'deki codes/<tarih> (Firebase konsolundan elle yazarsın, yeniden yayın gerekmez), yoksa DAILY_CODES
async function todaysCode(day) {
  try { const v = await fb("GET", `codes/${day}`); if (v) return String(v); } catch (e) {}
  return envCode(day);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return out(405, { ok: false });
  if (!BOT) return out(500, { ok: false, error: "BOT_TOKEN yok" });
  let b;
  try { b = JSON.parse(event.body || "{}"); } catch (e) { return out(400, { ok: false }); }
  const user = checkInitData(String(b.initData || ""));
  if (!user) return out(401, { ok: false, error: "Geçersiz Telegram oturumu" });
  const needFb = () => FB && FBS;

  try {
    if (b.mode === "tg") {
      const r = await fetch(`https://api.telegram.org/bot${BOT}/getChatMember?chat_id=${encodeURIComponent(CHANNEL)}&user_id=${user.id}`);
      const j = await r.json();
      const st = j.ok && j.result && j.result.status;
      const member = ["creator", "administrator", "member"].includes(st) || (st === "restricted" && j.result.is_member === true);
      return out(200, { ok: true, member });
    }

    if (b.mode === "code") {
      if (!needFb()) return out(500, { ok: false, error: "Firebase ayarlı değil" });
      const day = trDay(), secret = await todaysCode(day);
      if (!secret) return out(200, { ok: true, status: "none" });
      if (await fb("GET", `claims/${day}/${user.id}`)) return out(200, { ok: true, status: "already" });
      const tries = Number(await fb("GET", `tries/${day}/${user.id}`)) || 0;
      if (tries >= 5) return out(200, { ok: true, status: "limit" });
      await fb("PUT", `tries/${day}/${user.id}`, "", tries + 1);
      if (crypto.timingSafeEqual(sha(b.code), sha(secret))) {
        await fb("PUT", `claims/${day}/${user.id}`, "", Date.now());
        return out(200, { ok: true, status: "correct", reward: REWARD });
      }
      return out(200, { ok: true, status: "wrong", left: 4 - tries });
    }

    if (b.mode === "score") {
      if (!needFb()) return out(500, { ok: false, error: "Firebase ayarlı değil" });
      const s = Math.floor(Number(b.score));
      if (!Number.isFinite(s) || s < 0 || s > 1e13) return out(400, { ok: false });
      const n = clean(b.name, 20) || clean(user.first_name, 20) || "Oyuncu";
      await fb("PUT", `players/${user.id}`, "", { n, s, t: Date.now() });
      return out(200, { ok: true });
    }

    if (b.mode === "top") {
      if (!needFb()) return out(500, { ok: false, error: "Firebase ayarlı değil" });
      const top = await fb("GET", "players", 'orderBy="s"&limitToLast=50') || {};
      const list = Object.entries(top).map(([id, p]) => ({ n: p.n, s: p.s, me: id === String(user.id) })).sort((x, y) => y.s - x.s);
      const mine = await fb("GET", `players/${user.id}`);
      let rank = null;
      if (mine) {
        const above = await fb("GET", "players", `orderBy="s"&startAt=${mine.s + 1}&limitToFirst=1001`) || {};
        const c = Object.keys(above).length;
        rank = c > 1000 ? null : c + 1;
      }
      return out(200, { ok: true, top: list, me: mine ? mine.s : 0, rank });
    }
  } catch (e) {
    return out(502, { ok: false, error: "Sunucu hatası" });
  }
  return out(400, { ok: false });
};
