// SAM: customer app + admin panel server. Node ≥22.5, SQLite (node:sqlite), no framework.
// Customers (shops / agencies) see products by category with their own price level, order, and make proformas;
// the SAM team manages products, customers, orders, festivals, and imports price lists, invoices and balances.
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readXlsx, readCsv } from "./lib/xlsx.mjs";
import { readPdf } from "./lib/pdf.mjs";
import { pricePreview, invoicePreview, balancePreview, guess, norm } from "./lib/importer.mjs";
import { parseDate } from "./lib/jalali.mjs";
import { hash, checkPass } from "./lib/pass.mjs";
import { buildProforma, suggestOffer } from "./web/proforma.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOADS = path.join(DATA, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

// ---------- database ----------
export function openDb(file = path.join(DATA, "sam.db")) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, role TEXT NOT NULL, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
    name TEXT NOT NULL, contact TEXT DEFAULT '', phone TEXT DEFAULT '', city TEXT DEFAULT '', code TEXT DEFAULT '', level TEXT DEFAULT 'A',
    active INTEGER DEFAULT 1, created TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, uid INTEGER NOT NULL, exp INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS cats(id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, code TEXT DEFAULT '', name TEXT NOT NULL, cat INTEGER, img TEXT DEFAULT '',
    pack INTEGER DEFAULT 1, unit TEXT DEFAULT 'عدد', descr TEXT DEFAULT '', prices TEXT DEFAULT '{}', active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0,
    updated TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, uid INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, items TEXT NOT NULL,
    total INTEGER NOT NULL, note TEXT DEFAULT '', returns TEXT DEFAULT '[]', created TEXT DEFAULT (datetime('now')), updated TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS festivals(id INTEGER PRIMARY KEY, title TEXT NOT NULL, poster TEXT DEFAULT '', descr TEXT DEFAULT '', min_amount INTEGER DEFAULT 0,
    start TEXT NOT NULL, end TEXT NOT NULL, settle TEXT DEFAULT '', active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, uid INTEGER, cust TEXT NOT NULL, no TEXT NOT NULL, kind TEXT NOT NULL, date TEXT DEFAULT '',
    date_raw TEXT DEFAULT '', amount INTEGER NOT NULL, batch TEXT, items TEXT DEFAULT '[]', UNIQUE(kind, no));
  CREATE TABLE IF NOT EXISTS balances(uid INTEGER PRIMARY KEY, amount INTEGER NOT NULL, as_of TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY, kind TEXT, file TEXT, summary TEXT, at TEXT DEFAULT (datetime('now')), by INTEGER);`);
  // older test databases: invoices gained item lines (2026-11-24)
  const addCol = (t, c, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  addCol("invoices", "items", "TEXT DEFAULT '[]'");
  // offers, margins and admin-issued proformas (owner, 2026-11-24)
  addCol("products", "offer", "INTEGER DEFAULT 0");        // 0 = none, N = «N به ۱»
  addCol("users", "margin", "REAL DEFAULT 0");             // % taken off the proforma for this customer
  addCol("users", "offer", "TEXT DEFAULT 'product'");      // product | none | 1…9
  addCol("orders", "proforma", "TEXT");                    // JSON from buildProforma, set when the admin approves
  addCol("orders", "seen", "INTEGER DEFAULT 1");           // 0 = the customer hasn't opened the new proforma yet
  return db;
}


const DEFAULTS = { brand: "SAM", currency: "تومان", levels: [{ k: "A", name: "نمایندگی" }, { k: "B", name: "عمده‌فروش" }, { k: "C", name: "مغازه" }], phone: "", proformaNote: "اعتبار پیش‌فاکتور تا پایان همان روز است.", taxPct: 10, marginPct: 0 };
const setting = (db, k) => { const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k); return r ? JSON.parse(r.v) : DEFAULTS[k]; };
const settings = db => Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, setting(db, k)]));

const prod = r => r && ({ ...r, prices: JSON.parse(r.prices || "{}"), active: !!r.active });
const ord = r => r && ({ ...r, items: JSON.parse(r.items), returns: JSON.parse(r.returns || "[]"), proforma: r.proforma ? JSON.parse(r.proforma) : null, seen: r.seen !== 0 });
const pubUser = u => u && ({ id: u.id, role: u.role, username: u.username, name: u.name, contact: u.contact, phone: u.phone, city: u.city, code: u.code, level: u.level, active: !!u.active, created: u.created, margin: u.margin ?? 0, offer: u.offer || "product" });
const today = () => new Date().toISOString().slice(0, 10);

// What one customer bought inside a festival's dates: invoices when the accountants have imported them, otherwise app orders.
function boughtBetween(db, uid, start, end) {
  const inv = db.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'sale' THEN amount ELSE -amount END),0) s, COUNT(*) n FROM invoices WHERE uid=? AND date BETWEEN ? AND ?").get(uid, start, end);
  if (inv.n) return inv.s;
  return db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE uid=? AND kind='order' AND status NOT IN ('cancelled') AND substr(created,1,10) BETWEEN ? AND ?").get(uid, start, end).s;
}

// Per-agency report for the owner (2026-11-24): sales, returns, how often they order.
export function report(db) {
  const custs = db.prepare("SELECT * FROM users WHERE role='customer'").all();
  return custs.map(u => {
    const inv = db.prepare("SELECT kind, COUNT(*) n, COALESCE(SUM(amount),0) s FROM invoices WHERE uid=? GROUP BY kind").all(u.id);
    const sale = inv.find(x => x.kind === "sale"), ret = inv.find(x => x.kind === "return");
    const orders = db.prepare("SELECT created, total, returns FROM orders WHERE uid=? AND kind='order' AND status!='cancelled' ORDER BY created").all(u.id);
    const orderReturns = orders.reduce((a, o) => a + JSON.parse(o.returns || "[]").reduce((b, x) => b + (x.amount || 0), 0), 0);
    const dates = orders.map(o => o.created.slice(0, 10));
    const invDates = db.prepare("SELECT DISTINCT date FROM invoices WHERE uid=? AND kind='sale' AND date!='' ORDER BY date").all(u.id).map(r => r.date);
    const ds = invDates.length > dates.length ? invDates : dates;
    const gaps = ds.slice(1).map((d, i) => (Date.parse(d) - Date.parse(ds[i])) / 864e5).filter(g => g > 0);
    const last = ds[ds.length - 1] || "";
    const bal = db.prepare("SELECT amount, as_of FROM balances WHERE uid=?").get(u.id);
    return {
      id: u.id, name: u.name, city: u.city, code: u.code, active: !!u.active,
      source: sale ? "invoices" : "orders",
      sales: sale ? sale.s : orders.reduce((a, o) => a + o.total, 0),
      count: sale ? sale.n : orders.length,
      returns: (ret ? ret.s : 0) + orderReturns,
      returnCount: (ret ? ret.n : 0) + orders.filter(o => JSON.parse(o.returns || "[]").length).length,
      last, sinceLast: last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null,
      every: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
      balance: bal ? bal.amount : null, balanceAt: bal ? bal.as_of : null,
    };
  });
}

// ---------- files ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };
function saveImage(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) throw Object.assign(new Error("عکس معتبر نیست"), { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 4e6) throw Object.assign(new Error("عکس بزرگ‌تر از ۴ مگابایت است"), { status: 400 });
  const name = crypto.randomBytes(9).toString("hex") + "." + (m[1] === "jpeg" ? "jpg" : m[1]);
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return "/uploads/" + name;
}
async function readSheets(fileName, b64) {
  const buf = Buffer.from(String(b64).replace(/^data:[^,]*,/, ""), "base64");
  const ext = path.extname(String(fileName)).toLowerCase();
  try {
    if (ext === ".xlsx" || ext === ".xlsm") return readXlsx(buf);
    if (ext === ".csv" || ext === ".txt") return readCsv(buf.toString("utf8").replace(/^﻿/, ""));
    if (ext === ".pdf") return await readPdf(buf);
  } catch (e) {
    throw Object.assign(new Error(ext === ".pdf" ? "متن این پی‌دی‌اف خوانده نشد؛ اگر اسکن است، فایل اکسل بفرستید." : "فایل خوانده نشد."), { status: 400 });
  }
  if (ext === ".xls") throw Object.assign(new Error("فرمت قدیمی .xls است؛ در اکسل «Save As → xlsx» کنید و دوباره بفرستید."), { status: 400 });
  throw Object.assign(new Error("فقط اکسل (xlsx)، CSV یا پی‌دی‌اف"), { status: 400 });
}

// ---------- app ----------
export function createApp(db) {
  const fail = (status, msg) => { throw Object.assign(new Error(msg), { status }); };
  const tries = new Map(); // login attempts per ip

  function auth(req) {
    const t = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!t) return null;
    const s = db.prepare("SELECT * FROM sessions WHERE token=? AND exp>?").get(crypto.createHash("sha256").update(t).digest("hex"), Date.now());
    if (!s) return null;
    const u = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(s.uid);
    return u || null;
  }
  const needUser = req => auth(req) || fail(401, "لطفاً دوباره وارد شوید");
  const needAdmin = req => { const u = needUser(req); if (u.role !== "admin") fail(403, "دسترسی ندارید"); return u; };

  function catalogFor(u) {
    const cats = db.prepare("SELECT * FROM cats ORDER BY sort, id").all();
    const products = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY sort, id").all().map(prod).map(p => ({ id: p.id, code: p.code, name: p.name, cat: p.cat, img: p.img, pack: p.pack, unit: p.unit, descr: p.descr, price: p.prices[u.level] ?? null }));
    return { cats, products };
  }
  function festivalsFor(u, all = false) {
    const d = today();
    const rows = all ? db.prepare("SELECT * FROM festivals ORDER BY start DESC").all() : db.prepare("SELECT * FROM festivals WHERE active=1 AND end>=? ORDER BY start").all(d);
    return rows.map(f => ({ ...f, active: !!f.active, running: f.start <= d && f.end >= d, bought: u && u.role === "customer" ? boughtBetween(db, u.id, f.start, f.end) : undefined }));
  }
  function priceItems(u, items) {
    if (!Array.isArray(items) || !items.length) fail(400, "سبد خالی است");
    const out = [];
    for (const it of items.slice(0, 300)) {
      const p = prod(db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(+it.id));
      const qty = Math.floor(+it.qty);
      if (!p || !(qty > 0) || qty > 100000) continue;
      const price = p.prices[u.level];
      if (price == null) fail(400, `«${p.name}» قیمت ندارد`);
      out.push({ id: p.id, code: p.code, name: p.name, qty, price, sum: price * qty });
    }
    if (!out.length) fail(400, "سبد خالی است");
    return out;
  }

  const routes = {
    "GET /api/health": () => ({ ok: true }),
    "GET /api/brand": () => { const s = settings(db); return { brand: s.brand, phone: s.phone }; },
    "POST /api/login": (req, b) => {
      const ip = req.socket.remoteAddress, t = tries.get(ip) || { n: 0, at: Date.now() };
      if (Date.now() - t.at > 15 * 60e3) { t.n = 0; t.at = Date.now(); }
      if (t.n >= 10) fail(429, "تلاش زیاد؛ ۱۵ دقیقه دیگر امتحان کنید");
      const u = db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(String(b.u || "").trim().toLowerCase());
      if (!u || !checkPass(b.p, u.pass)) { t.n++; tries.set(ip, t); fail(401, "نام کاربری یا رمز اشتباه است"); }
      tries.delete(ip);
      const token = crypto.randomBytes(24).toString("base64url");
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(crypto.createHash("sha256").update(token).digest("hex"), u.id, Date.now() + 60 * 864e5);
      return { token, user: pubUser(u) };
    },
    "POST /api/logout": req => { const t = (req.headers.authorization || "").replace(/^Bearer /, ""); db.prepare("DELETE FROM sessions WHERE token=?").run(crypto.createHash("sha256").update(t).digest("hex")); return { ok: true }; },
    "GET /api/me": req => ({ user: pubUser(needUser(req)), settings: settings(db) }),
    "POST /api/password": (req, b) => {
      const u = needUser(req);
      if (!checkPass(b.old, u.pass)) fail(400, "رمز فعلی اشتباه است");
      if (String(b.new || "").length < 6) fail(400, "رمز جدید حداقل ۶ حرف باشد");
      db.prepare("UPDATE users SET pass=? WHERE id=?").run(hash(b.new), u.id);
      return { ok: true };
    },

    // ----- customer -----
    "GET /api/catalog": req => { const u = needUser(req); return { ...catalogFor(u), festivals: festivalsFor(u), settings: settings(db), unseen: db.prepare("SELECT COUNT(*) n FROM orders WHERE uid=? AND seen=0").get(u.id).n }; },
    "POST /api/orders/:id/seen": (req, b, id) => { const u = needUser(req); db.prepare("UPDATE orders SET seen=1 WHERE id=? AND uid=?").run(id, u.id); return { ok: true }; },
    "GET /api/orders": req => { const u = needUser(req); return db.prepare("SELECT * FROM orders WHERE uid=? ORDER BY id DESC LIMIT 200").all(u.id).map(ord); },
    "POST /api/orders": (req, b) => {
      const u = needUser(req); if (u.role !== "customer") fail(403, "فقط مشتری سفارش می‌دهد");
      const items = priceItems(u, b.items), total = items.reduce((a, i) => a + i.sum, 0);
      // every order waits for the sales team (owner, 2026-11-24): no proforma until an admin approves it
      const r = db.prepare("INSERT INTO orders(uid,kind,status,items,total,note) VALUES(?,?,?,?,?,?)").run(u.id, "order", "new", JSON.stringify(items), total, String(b.note || "").slice(0, 500));
      return ord(db.prepare("SELECT * FROM orders WHERE id=?").get(r.lastInsertRowid));
    },
    "POST /api/orders/:id/submit": (req, b, id) => { // a proforma becomes an order, at today's prices
      const u = needUser(req), o = ord(db.prepare("SELECT * FROM orders WHERE id=? AND uid=?").get(id, u.id));
      if (!o || o.kind !== "proforma") fail(404, "پیش‌فاکتور پیدا نشد");
      const items = priceItems(u, o.items.map(i => ({ id: i.id, qty: i.qty }))), total = items.reduce((a, i) => a + i.sum, 0);
      db.prepare("UPDATE orders SET kind='order', status='new', items=?, total=?, updated=datetime('now') WHERE id=?").run(JSON.stringify(items), total, id);
      return ord(db.prepare("SELECT * FROM orders WHERE id=?").get(id));
    },
    "POST /api/orders/:id/cancel": (req, b, id) => {
      const u = needUser(req), o = db.prepare("SELECT * FROM orders WHERE id=? AND uid=?").get(id, u.id);
      if (!o || !["new", "open"].includes(o.status)) fail(400, "این سفارش دیگر قابل لغو نیست");
      db.prepare("UPDATE orders SET status='cancelled', updated=datetime('now') WHERE id=?").run(id);
      return { ok: true };
    },
    "GET /api/account": req => {
      const u = needUser(req);
      return { invoices: db.prepare("SELECT no, kind, date, date_raw, amount, items FROM invoices WHERE uid=? ORDER BY date DESC, no DESC LIMIT 500").all(u.id).map(i => ({ ...i, items: JSON.parse(i.items || "[]") })), balance: db.prepare("SELECT amount, as_of FROM balances WHERE uid=?").get(u.id) || null, festivals: festivalsFor(u) };
    },

    // ----- admin -----
    "GET /api/admin/overview": req => {
      needAdmin(req);
      const c = q => db.prepare(q).get().n;
      return { newOrders: c("SELECT COUNT(*) n FROM orders WHERE kind='order' AND status='new'"), customers: c("SELECT COUNT(*) n FROM users WHERE role='customer' AND active=1"), products: c("SELECT COUNT(*) n FROM products WHERE active=1"), noPrice: db.prepare("SELECT prices FROM products WHERE active=1").all().filter(p => p.prices === "{}").length, festivals: festivalsFor(null).filter(f => f.running).length };
    },
    "GET /api/admin/report": req => { needAdmin(req); return report(db); },
    "GET /api/admin/settings": req => { needAdmin(req); return settings(db); },
    "POST /api/admin/settings": (req, b) => {
      needAdmin(req);
      for (const k of Object.keys(DEFAULTS)) if (k in b) {
        let v = b[k];
        if (k === "levels") v = (Array.isArray(v) ? v : []).map(l => ({ k: String(l.k).trim().slice(0, 8), name: String(l.name).trim().slice(0, 40) })).filter(l => l.k && l.name);
        else if (k === "taxPct" || k === "marginPct") { v = Math.round(+v * 100) / 100; if (!(v >= 0 && v <= 100)) fail(400, "درصد باید بین ۰ و ۱۰۰ باشد"); }
        else v = String(v).slice(0, 300);
        if (k === "levels" && !v.length) fail(400, "حداقل یک سطح قیمت لازم است");
        db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, JSON.stringify(v));
      }
      return settings(db);
    },
    "POST /api/admin/upload": (req, b) => { needAdmin(req); return { url: saveImage(b.data) }; },

    "GET /api/admin/cats": req => { needAdmin(req); return db.prepare("SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.cat=c.id AND p.active=1) n FROM cats c ORDER BY sort, id").all(); },
    "POST /api/admin/cats": (req, b) => {
      needAdmin(req);
      const list = Array.isArray(b.cats) ? b.cats : [];
      const keep = [];
      list.forEach((c, i) => {
        const name = String(c.name || "").replace(/\s+/g, " ").trim().slice(0, 60); if (!name) return;
        if (c.id) { db.prepare("UPDATE cats SET name=?, sort=? WHERE id=?").run(name, i, +c.id); keep.push(+c.id); }
        else keep.push(Number(db.prepare("INSERT INTO cats(name,sort) VALUES(?,?)").run(name, i).lastInsertRowid));
      });
      const gone = db.prepare("SELECT id FROM cats").all().map(r => r.id).filter(id => !keep.includes(id));
      for (const id of gone) { db.prepare("UPDATE products SET cat=NULL WHERE cat=?").run(id); db.prepare("DELETE FROM cats WHERE id=?").run(id); }
      return db.prepare("SELECT * FROM cats ORDER BY sort, id").all();
    },

    "GET /api/admin/products": req => { needAdmin(req); return db.prepare("SELECT * FROM products ORDER BY active DESC, sort, id").all().map(prod); },
    "POST /api/admin/products": (req, b) => {
      needAdmin(req);
      const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 120); if (!name) fail(400, "نام محصول لازم است");
      const levels = setting(db, "levels").map(l => l.k), prices = {};
      for (const [k, v] of Object.entries(b.prices || {})) if (levels.includes(k) && v !== "" && v != null && +v >= 0) prices[k] = Math.round(+v);
      const f = [String(b.code || "").trim().slice(0, 40), name, b.cat ? +b.cat : null, String(b.img || ""), Math.max(1, +b.pack || 1), String(b.unit || "عدد").slice(0, 20), String(b.descr || "").slice(0, 1000), JSON.stringify(prices), b.active === false ? 0 : 1, Math.max(0, Math.min(9, Math.floor(+b.offer || 0)))];
      if (b.id) db.prepare("UPDATE products SET code=?, name=?, cat=?, img=?, pack=?, unit=?, descr=?, prices=?, active=?, offer=?, updated=datetime('now') WHERE id=?").run(...f, +b.id);
      else b.id = db.prepare("INSERT INTO products(code,name,cat,img,pack,unit,descr,prices,active,offer) VALUES(?,?,?,?,?,?,?,?,?,?)").run(...f).lastInsertRowid;
      return prod(db.prepare("SELECT * FROM products WHERE id=?").get(b.id));
    },
    "POST /api/admin/products/:id/delete": (req, b, id) => { needAdmin(req); db.prepare("UPDATE products SET active=0 WHERE id=?").run(id); return { ok: true }; },

    "GET /api/admin/customers": req => { needAdmin(req); return db.prepare("SELECT * FROM users WHERE role='customer' ORDER BY active DESC, name").all().map(pubUser); },
    "POST /api/admin/customers": (req, b) => {
      needAdmin(req);
      const username = String(b.username || "").trim().toLowerCase();
      if (!/^[a-z0-9_.]{3,30}$/.test(username)) fail(400, "نام کاربری: ۳ تا ۳۰ حرف انگلیسی یا عدد");
      const name = String(b.name || "").trim().slice(0, 80); if (!name) fail(400, "نام فروشگاه لازم است");
      const dup = db.prepare("SELECT id FROM users WHERE username=?").get(username);
      if (dup && dup.id !== +b.id) fail(400, "این نام کاربری گرفته شده");
      const f = [username, name, String(b.contact || "").slice(0, 80), String(b.phone || "").slice(0, 20), String(b.city || "").slice(0, 40), String(b.code || "").trim().slice(0, 40), String(b.level || "A"), b.active === false ? 0 : 1, Math.max(0, Math.min(100, Math.round((+b.margin || 0) * 100) / 100)), /^(product|none|[1-9])$/.test(String(b.offer)) ? String(b.offer) : "product"];
      if (b.id) {
        db.prepare("UPDATE users SET username=?, name=?, contact=?, phone=?, city=?, code=?, level=?, active=?, margin=?, offer=? WHERE id=? AND role='customer'").run(...f, +b.id);
        if (b.password) { if (String(b.password).length < 6) fail(400, "رمز حداقل ۶ حرف"); db.prepare("UPDATE users SET pass=? WHERE id=?").run(hash(b.password), +b.id); db.prepare("DELETE FROM sessions WHERE uid=?").run(+b.id); }
        if (b.active === false) db.prepare("DELETE FROM sessions WHERE uid=?").run(+b.id);
      } else {
        if (String(b.password || "").length < 6) fail(400, "رمز حداقل ۶ حرف");
        b.id = db.prepare("INSERT INTO users(role,username,pass,name,contact,phone,city,code,level,active,margin,offer) VALUES('customer',?,?,?,?,?,?,?,?,?,?,?)").run(username, hash(b.password), ...f.slice(1)).lastInsertRowid;
      }
      return pubUser(db.prepare("SELECT * FROM users WHERE id=?").get(b.id));
    },

    "GET /api/admin/orders": (req) => {
      needAdmin(req);
      const offerOf = new Map(db.prepare("SELECT id, offer FROM products").all().map(p => [p.id, p.offer]));
      return db.prepare("SELECT o.*, u.name uname, u.city ucity, u.phone uphone, u.margin umargin, u.offer uoffer FROM orders o JOIN users u ON u.id=o.uid ORDER BY o.id DESC LIMIT 500").all().map(ord)
        .map(o => ({ ...o, items: o.items.map(i => ({ ...i, sugOffer: suggestOffer(offerOf.get(i.id), o.uoffer) })) }));
    },
    // approve an order: the sales manager's offers per item + tax + this customer's margin → proforma for the customer
    "POST /api/admin/orders/:id/proforma": (req, b, id) => {
      needAdmin(req);
      const o = ord(db.prepare("SELECT * FROM orders WHERE id=?").get(id)); if (!o) fail(404, "سفارش پیدا نشد");
      if (o.status === "cancelled") fail(400, "سفارش لغو شده است");
      const pf = buildProforma(o.items, { offers: b.offers || {}, taxPct: b.taxPct ?? setting(db, "taxPct"), marginPct: b.marginPct ?? 0 });
      pf.issued = new Date().toISOString();
      db.prepare("UPDATE orders SET proforma=?, total=?, status=CASE WHEN status='new' THEN 'confirmed' ELSE status END, seen=0, updated=datetime('now') WHERE id=?").run(JSON.stringify(pf), pf.total, id);
      return ord(db.prepare("SELECT * FROM orders WHERE id=?").get(id));
    },
    "POST /api/admin/orders/:id": (req, b, id) => {
      needAdmin(req);
      const o = ord(db.prepare("SELECT * FROM orders WHERE id=?").get(id)); if (!o) fail(404, "سفارش پیدا نشد");
      if (b.status && ["new", "confirmed", "sent", "done", "cancelled"].includes(b.status)) db.prepare("UPDATE orders SET status=?, updated=datetime('now') WHERE id=?").run(b.status, id);
      if (b.addReturn) {
        const r = b.addReturn, it = o.items.find(i => i.id === +r.id), qty = Math.floor(+r.qty);
        if (!it || !(qty > 0)) fail(400, "کالا و تعداد مرجوعی را درست وارد کنید");
        const already = o.returns.filter(x => x.id === it.id).reduce((a, x) => a + x.qty, 0);
        if (already + qty > it.qty) fail(400, "مرجوعی بیشتر از تعداد سفارش است");
        o.returns.push({ id: it.id, name: it.name, qty, amount: qty * it.price, note: String(r.note || "").slice(0, 200), date: today() });
        db.prepare("UPDATE orders SET returns=?, updated=datetime('now') WHERE id=?").run(JSON.stringify(o.returns), id);
      }
      return ord(db.prepare("SELECT * FROM orders WHERE id=?").get(id));
    },

    "GET /api/admin/festivals": req => { needAdmin(req); return festivalsFor(null, true); },
    "POST /api/admin/festivals": (req, b) => {
      needAdmin(req);
      const title = String(b.title || "").trim().slice(0, 120); if (!title) fail(400, "عنوان جشنواره لازم است");
      const start = parseDate(b.start), end = parseDate(b.end);
      if (!start || !end) fail(400, "تاریخ شروع و پایان را مثل ۱۴۰۵/۰۹/۱۰ وارد کنید");
      if (end < start) fail(400, "تاریخ پایان قبل از شروع است");
      const f = [title, String(b.poster || ""), String(b.descr || "").slice(0, 3000), Math.max(0, Math.round(+b.min_amount || 0)), start, end, String(b.settle || "").slice(0, 1000), b.active === false ? 0 : 1];
      if (b.id) db.prepare("UPDATE festivals SET title=?, poster=?, descr=?, min_amount=?, start=?, end=?, settle=?, active=? WHERE id=?").run(...f, +b.id);
      else b.id = db.prepare("INSERT INTO festivals(title,poster,descr,min_amount,start,end,settle,active) VALUES(?,?,?,?,?,?,?,?)").run(...f).lastInsertRowid;
      return db.prepare("SELECT * FROM festivals WHERE id=?").get(b.id);
    },
    "POST /api/admin/festivals/:id/delete": (req, b, id) => { needAdmin(req); db.prepare("DELETE FROM festivals WHERE id=?").run(id); return { ok: true }; },
    "GET /api/admin/festivals/:id/progress": (req, b, id) => {
      needAdmin(req); const f = db.prepare("SELECT * FROM festivals WHERE id=?").get(id); if (!f) fail(404, "پیدا نشد");
      return db.prepare("SELECT id, name, city FROM users WHERE role='customer' AND active=1").all().map(u => ({ ...u, bought: boughtBetween(db, u.id, f.start, f.end) })).sort((a, b) => b.bought - a.bought);
    },

    // ----- importers: read file → guess columns → preview → apply -----
    "POST /api/admin/import/read": async (req, b) => {
      needAdmin(req);
      const sheets = await readSheets(b.name, b.data);
      const fields = { prices: ["code", "name", "price"], invoices: ["cust", "no", "date", "amount", "kind", "item", "qty", "unit"], balances: ["cust", "balance", "debit", "credit"] }[b.kind] || [];
      return { sheets: sheets.map(s => ({ name: s.name, rows: s.rows.slice(0, 5000), guess: guess(s.rows, fields) })) };
    },
    "POST /api/admin/import/preview": (req, b) => { needAdmin(req); return preview(b); },
    "POST /api/admin/import/apply": (req, b) => {
      const admin = needAdmin(req), pv = preview(b), batch = crypto.randomBytes(6).toString("hex");
      db.exec("BEGIN");
      try {
        if (b.kind === "prices") {
          for (const it of pv.items) {
            if (it.status === "changed") { const p = prod(db.prepare("SELECT * FROM products WHERE id=?").get(it.pid)); db.prepare("UPDATE products SET prices=?, updated=datetime('now') WHERE id=?").run(JSON.stringify({ ...p.prices, ...it.prices }), it.pid); }
            if (it.status === "new" && b.createNew) db.prepare("INSERT INTO products(code,name,prices,cat) VALUES(?,?,?,?)").run(it.code, it.name || it.code, JSON.stringify(it.prices), b.newCat ? +b.newCat : null);
          }
        } else if (b.kind === "invoices") {
          for (const it of pv.items) db.prepare("INSERT INTO invoices(uid,cust,no,kind,date,date_raw,amount,batch,items) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,no) DO UPDATE SET uid=excluded.uid, cust=excluded.cust, date=excluded.date, date_raw=excluded.date_raw, amount=excluded.amount, batch=excluded.batch, items=excluded.items").run(it.uid, it.cust, it.no, it.kind, it.date, it.dateRaw, it.amount, batch, JSON.stringify(it.items || []));
        } else if (b.kind === "balances") {
          const asOf = parseDate(b.asOf) || today();
          for (const it of pv.items.filter(i => i.uid)) db.prepare("INSERT INTO balances VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET amount=excluded.amount, as_of=excluded.as_of").run(it.uid, it.balance, asOf);
        }
        db.prepare("INSERT INTO imports(kind,file,summary,by) VALUES(?,?,?,?)").run(b.kind, String(b.file || "").slice(0, 200), JSON.stringify(pv.summary), admin.id);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return { ok: true, summary: pv.summary };
    },
    "GET /api/admin/imports": req => { needAdmin(req); return db.prepare("SELECT * FROM imports ORDER BY id DESC LIMIT 50").all().map(r => ({ ...r, summary: JSON.parse(r.summary || "{}") })); },
  };

  function preview(b) {
    const rows = Array.isArray(b.rows) ? b.rows : fail(400, "فایل خوانده نشده");
    const opt = { headerRow: +b.headerRow || 0, map: b.map || {}, factor: +b.factor || 1, custBy: b.custBy === "name" ? "name" : "code" };
    const customers = db.prepare("SELECT id, name, code FROM users WHERE role='customer'").all();
    if (b.kind === "prices") return pricePreview(rows, opt, db.prepare("SELECT * FROM products").all().map(prod));
    if (b.kind === "invoices") { if ([opt.map.cust, opt.map.no, opt.map.amount].some(v => v == null)) fail(400, "ستون مشتری، شماره و مبلغ را انتخاب کنید"); return invoicePreview(rows, opt, customers); }
    if (b.kind === "balances") { if (opt.map.cust == null || (opt.map.balance == null && opt.map.debit == null && opt.map.credit == null)) fail(400, "ستون مشتری و مانده را انتخاب کنید"); return balancePreview(rows, opt, customers); }
    fail(400, "نوع فایل نامعلوم");
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname.startsWith("/api/")) {
        let key = req.method + " " + url.pathname, id = null;
        if (!routes[key]) { const m = url.pathname.match(/^(.*\/)(\d+)(\/[a-z]+)?$/); if (m) { key = req.method + " " + m[1] + ":id" + (m[3] || ""); id = +m[2]; } }
        const fn = routes[key]; if (!fn) fail(404, "پیدا نشد");
        let body = {};
        if (req.method === "POST") {
          const chunks = []; let size = 0;
          for await (const c of req) { size += c.length; if (size > 30e6) fail(413, "فایل خیلی بزرگ است"); chunks.push(c); }
          body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        }
        const out = await fn(req, body, id);
        const json = JSON.stringify(out), gz = json.length > 1400 && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Accept-Encoding", ...(gz ? { "Content-Encoding": "gzip" } : {}) });
        return res.end(gz ? zlib.gzipSync(json) : json);
      }
      // static: web/, uploads
      let p = decodeURIComponent(url.pathname);
      let file;
      if (p.startsWith("/uploads/")) file = path.join(UPLOADS, path.basename(p));
      else {
        if (p.endsWith("/")) p += "index.html";
        file = path.join(ROOT, "web", path.normalize(p).replace(/^(\.\.[\/\\])+/, ""));
        if (!file.startsWith(path.join(ROOT, "web"))) fail(403, "no");
        if (!fs.existsSync(file) && !path.extname(file)) file = fs.existsSync(file + "/index.html") ? file + "/index.html" : path.join(ROOT, "web/index.html");
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(404, "پیدا نشد");
      const ext = path.extname(file).toLowerCase();
      // text files go gzipped (fonts and images are already compressed)
      const gz = [".html", ".js", ".css", ".json", ".webmanifest", ".svg"].includes(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": [".html", ".js", ".css", ".webmanifest"].includes(ext) ? "no-cache" : "public, max-age=86400", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", Vary: "Accept-Encoding", ...(gz ? { "Content-Encoding": "gzip" } : {}) });
      const stream = fs.createReadStream(file);
      (gz ? stream.pipe(zlib.createGzip({ level: 6 })) : stream).pipe(res);
    } catch (e) {
      const status = e.status || (e instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(e);
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: status === 500 ? "خطای سرور" : e.message }));
    }
  };
}

// First run: an admin account (password from ADMIN_PASS, or a random one printed once).
export function ensureAdmin(db) {
  if (db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) return null;
  const pass = process.env.ADMIN_PASS || crypto.randomBytes(6).toString("base64url");
  db.prepare("INSERT INTO users(role,username,pass,name) VALUES('admin','admin',?,?)").run(hash(pass), "مدیر سام");
  return pass;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  const p = ensureAdmin(db);
  if (p) console.log(`admin account → username: admin  password: ${p}`);
  if (process.argv.includes("--demo")) (await import("./tools/demo.mjs")).seed(db);
  const port = +process.env.PORT || 3300;
  http.createServer(createApp(db)).listen(port, () => console.log(`SAM on http://localhost:${port}  (panel: /admin/)`));
}
