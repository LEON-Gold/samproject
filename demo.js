// Demo backend for GitHub Pages: the same /api answers as server.mjs, kept in this browser's localStorage.
// Sample data only (made-up products, customers, prices). Customer app and admin panel share it in one browser,
// so a visitor can order as a customer, approve in the panel, and see the proforma come back.
import { buildProforma, suggestOffer } from "./proforma.js?v=6";
import { parseDate, jalaliText } from "./jalali.js?v=6";

const KEY = "sam.demo.db.v1";
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const fail = (status, msg) => { throw Object.assign(new Error(msg), { status }); };

function seed() {
  const cats = ["اصلاح", "مو", "پوست", "بدن", "خوشبو‌کننده"].map((name, i) => ({ id: i + 1, name, sort: i }));
  const P = [["S-101", "فوم اصلاح (نمونه)", 1, 12, 185000, 2], ["S-102", "ژل اصلاح (نمونه)", 1, 12, 210000, 0], ["S-103", "افترشیو (نمونه)", 1, 6, 320000, 0],
    ["H-201", "شامپو مو (نمونه)", 2, 12, 240000, 4], ["H-202", "واکس مو (نمونه)", 2, 24, 195000, 0], ["H-203", "ژل مو (نمونه)", 2, 24, 150000, 3],
    ["K-301", "کرم مرطوب‌کننده (نمونه)", 3, 12, 290000, 0], ["K-302", "شوینده صورت (نمونه)", 3, 12, 260000, 0],
    ["B-401", "شامپو بدن (نمونه)", 4, 12, 230000, 5], ["B-402", "دئودورانت (نمونه)", 5, 24, 175000, 0], ["B-403", "اسپری بدن (نمونه)", 5, 24, 205000, 0]];
  const products = P.map(([code, name, cat, pack, a, offer], i) => ({ id: i + 1, code, name, cat, img: "", pack, unit: "عدد", descr: "", active: true, sort: 0, offer,
    prices: { A: a, B: Math.round(a * 1.06 / 1000) * 1000, C: Math.round(a * 1.15 / 1000) * 1000 }, updated: now() }));
  const users = [
    { id: 1, role: "admin", username: "admin", pass: "admin1234", name: "مدیر سام" },
    { id: 2, role: "customer", username: "demo", pass: "demo1234", name: "فروشگاه نمونه", contact: "", phone: "", city: "تهران", code: "1001", level: "A", margin: 18, offer: "product" },
    { id: 3, role: "customer", username: "demo2", pass: "demo1234", name: "عمده‌فروشی نمونه", contact: "", phone: "", city: "اصفهان", code: "1002", level: "B", margin: 12, offer: "none" },
  ].map(u => ({ contact: "", phone: "", city: "", code: "", level: "A", margin: 0, offer: "product", active: true, created: now(), ...u }));
  const item = (pid, qty) => { const p = products[pid - 1]; return { id: p.id, code: p.code, name: p.name, qty, price: p.prices.A, sum: p.prices.A * qty }; };
  const o1items = [item(1, 8), item(4, 12)], o2items = [item(2, 6), item(7, 4)];
  const pf = buildProforma(o1items, { offers: { 1: 2, 4: 4 }, taxPct: 10, marginPct: 18 }); pf.issued = new Date(Date.now() - 2 * 864e5).toISOString();
  const orders = [
    { id: 1, uid: 2, kind: "order", status: "confirmed", items: o1items, total: pf.total, note: "", returns: [], proforma: pf, seen: false, created: daysAgo(3) + " 10:20:00", updated: daysAgo(2) + " 09:00:00" },
    { id: 2, uid: 2, kind: "order", status: "new", items: o2items, total: o2items.reduce((a, i) => a + i.sum, 0), note: "لطفاً سریع‌تر ارسال شود", returns: [], proforma: null, seen: true, created: daysAgo(0) + " 08:10:00", updated: daysAgo(0) + " 08:10:00" },
  ];
  const inv = (no, uid, cust, d, lines, kind = "sale") => ({ no, uid, cust, kind, date: daysAgo(d), date_raw: "", amount: lines.reduce((a, l) => a + l.sum, 0), items: lines });
  const L = (name, qty, price) => ({ name, qty, price, sum: qty * price });
  const invoices = [inv("3101", 2, "1001", 40, [L("فوم اصلاح (نمونه)", 24, 185000), L("شامپو مو (نمونه)", 12, 240000)]),
    inv("3107", 2, "1001", 19, [L("دئودورانت (نمونه)", 24, 175000), L("کرم مرطوب‌کننده (نمونه)", 12, 290000)]),
    inv("3110", 3, "1002", 12, [L("شامپو بدن (نمونه)", 60, 244000)]), inv("B-15", 2, "1001", 2, [L("فوم اصلاح (نمونه)", 3, 185000)], "return")];
  return {
    seq: { users: 3, cats: 5, products: products.length, orders: 2, festivals: 1 },
    settings: { brand: "SAM", currency: "تومان", levels: [{ k: "A", name: "نمایندگی" }, { k: "B", name: "عمده‌فروش" }, { k: "C", name: "مغازه" }], phone: "", proformaNote: "اعتبار پیش‌فاکتور تا پایان همان روز است.", taxPct: 10, marginPct: 0 },
    users, cats, products, orders, invoices,
    festivals: [{ id: 1, title: "جشنوارهٔ نمونه", poster: "", descr: "این یک جشنوارهٔ آزمایشی است؛ متن و شرایط واقعی را تیم سام وارد می‌کند.", min_amount: 50000000, start: daysAgo(3), end: daysAgo(-27), settle: "متن نمونه برای نحوهٔ تسویه", active: true }],
    balances: { 2: { amount: 8082000, as_of: today() }, 3: { amount: -2500000, as_of: today() } },
    sessions: {}, imports: [],
  };
}
let db;
const load = () => { if (db) return db; try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {} return db = db || seed(); };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
export function resetDemo() { try { localStorage.removeItem(KEY); localStorage.removeItem("sam.token"); localStorage.removeItem("sam.admin.token"); } catch {} db = null; }
// another tab (the panel) changed the data → read it fresh next time
addEventListener("storage", e => { if (e.key === KEY) db = null; });

const pub = u => u && (({ pass, ...r }) => r)(u);
const next = t => ++db.seq[t];
const userOf = tok => { const id = db.sessions[tok]; const u = db.users.find(x => x.id === id && x.active); return u || null; };
const needUser = tok => userOf(tok) || fail(401, "لطفاً دوباره وارد شوید");
const needAdmin = tok => { const u = needUser(tok); if (u.role !== "admin") fail(403, "دسترسی ندارید"); return u; };
const bought = (uid, s, e) => {
  const inv = db.invoices.filter(i => i.uid === uid && i.date >= s && i.date <= e);
  if (inv.length) return inv.reduce((a, i) => a + (i.kind === "sale" ? i.amount : -i.amount), 0);
  return db.orders.filter(o => o.uid === uid && o.kind === "order" && o.status !== "cancelled" && o.created.slice(0, 10) >= s && o.created.slice(0, 10) <= e).reduce((a, o) => a + o.total, 0);
};
const festivals = (u, all) => { const d = today(); return db.festivals.filter(f => all || (f.active && f.end >= d)).map(f => ({ ...f, running: f.start <= d && f.end >= d, bought: u && u.role === "customer" ? bought(u.id, f.start, f.end) : undefined })); };
const withU = o => { const u = db.users.find(x => x.id === o.uid) || {}; return { ...o, uname: u.name, ucity: u.city, uphone: u.phone, umargin: u.margin, uoffer: u.offer }; };

function report() {
  return db.users.filter(u => u.role === "customer").map(u => {
    const inv = db.invoices.filter(i => i.uid === u.id), sale = inv.filter(i => i.kind === "sale"), ret = inv.filter(i => i.kind === "return");
    const orders = db.orders.filter(o => o.uid === u.id && o.kind === "order" && o.status !== "cancelled").sort((a, b) => a.created < b.created ? -1 : 1);
    const ds = sale.length ? [...new Set(sale.map(i => i.date))].sort() : orders.map(o => o.created.slice(0, 10));
    const gaps = ds.slice(1).map((d, i) => (Date.parse(d) - Date.parse(ds[i])) / 864e5).filter(g => g > 0), last = ds[ds.length - 1] || "";
    const bal = db.balances[u.id];
    return { id: u.id, name: u.name, city: u.city, code: u.code, active: u.active, source: sale.length ? "invoices" : "orders",
      sales: sale.length ? sale.reduce((a, i) => a + i.amount, 0) : orders.reduce((a, o) => a + o.total, 0), count: sale.length || orders.length,
      returns: ret.reduce((a, i) => a + i.amount, 0) + orders.reduce((a, o) => a + o.returns.reduce((b, r) => b + r.amount, 0), 0),
      returnCount: ret.length + orders.filter(o => o.returns.length).length, last, sinceLast: last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null,
      every: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null, balance: bal ? bal.amount : null, balanceAt: bal ? bal.as_of : null };
  });
}

const R = {
  "GET /api/health": () => ({ ok: true }),
  "POST /api/login": (t, b) => {
    const u = db.users.find(x => x.username === String(b.u || "").trim().toLowerCase() && x.active);
    if (!u || u.pass !== String(b.p)) fail(401, "نام کاربری یا رمز اشتباه است");
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36); db.sessions[token] = u.id; return { token, user: pub(u) };
  },
  "POST /api/logout": t => { delete db.sessions[t]; return { ok: true }; },
  "GET /api/me": t => ({ user: pub(needUser(t)), settings: db.settings }),
  "POST /api/password": (t, b) => { const u = needUser(t); if (u.pass !== String(b.old)) fail(400, "رمز فعلی اشتباه است"); if (String(b.new || "").length < 6) fail(400, "رمز جدید حداقل ۶ حرف باشد"); u.pass = String(b.new); return { ok: true }; },
  "GET /api/catalog": t => {
    const u = needUser(t);
    return { cats: [...db.cats].sort((a, b) => a.sort - b.sort), products: db.products.filter(p => p.active).map(p => ({ id: p.id, code: p.code, name: p.name, cat: p.cat, img: p.img, pack: p.pack, unit: p.unit, descr: p.descr, price: p.prices[u.level] ?? null })),
      festivals: festivals(u), settings: db.settings, unseen: db.orders.filter(o => o.uid === u.id && o.seen === false).length };
  },
  "GET /api/orders": t => { const u = needUser(t); return db.orders.filter(o => o.uid === u.id).sort((a, b) => b.id - a.id); },
  "POST /api/orders": (t, b) => {
    const u = needUser(t); if (u.role !== "customer") fail(403, "فقط مشتری سفارش می‌دهد");
    const items = (b.items || []).map(i => { const p = db.products.find(x => x.id === +i.id && x.active), qty = Math.floor(+i.qty); if (!p || !(qty > 0)) return null; const price = p.prices[u.level]; if (price == null) fail(400, `«${p.name}» قیمت ندارد`); return { id: p.id, code: p.code, name: p.name, qty, price, sum: qty * price }; }).filter(Boolean);
    if (!items.length) fail(400, "سبد خالی است");
    const o = { id: next("orders"), uid: u.id, kind: "order", status: "new", items, total: items.reduce((a, i) => a + i.sum, 0), note: String(b.note || "").slice(0, 500), returns: [], proforma: null, seen: true, created: now(), updated: now() };
    db.orders.push(o); return o;
  },
  "POST /api/orders/:id/seen": (t, b, id) => { const u = needUser(t), o = db.orders.find(x => x.id === id && x.uid === u.id); if (o) o.seen = true; return { ok: true }; },
  "POST /api/orders/:id/cancel": (t, b, id) => { const u = needUser(t), o = db.orders.find(x => x.id === id && x.uid === u.id); if (!o || o.status !== "new") fail(400, "این سفارش دیگر قابل لغو نیست"); o.status = "cancelled"; return { ok: true }; },
  "GET /api/account": t => { const u = needUser(t); return { invoices: db.invoices.filter(i => i.uid === u.id).sort((a, b) => a.date < b.date ? 1 : -1), balance: db.balances[u.id] || null, festivals: festivals(u) }; },

  "GET /api/admin/overview": t => { needAdmin(t); return { newOrders: db.orders.filter(o => o.status === "new").length, customers: db.users.filter(u => u.role === "customer" && u.active).length, products: db.products.filter(p => p.active).length, noPrice: db.products.filter(p => p.active && !Object.keys(p.prices).length).length, festivals: festivals(null).filter(f => f.running).length }; },
  "GET /api/admin/report": t => { needAdmin(t); return report(); },
  "GET /api/admin/settings": t => { needAdmin(t); return db.settings; },
  "POST /api/admin/settings": (t, b) => { needAdmin(t); for (const k of Object.keys(db.settings)) if (k in b) db.settings[k] = k === "taxPct" || k === "marginPct" ? +b[k] || 0 : b[k]; return db.settings; },
  "POST /api/admin/upload": (t, b) => { needAdmin(t); if (String(b.data).length > 1.5e6) fail(400, "در نسخهٔ نمایشی عکس کوچک‌تر بدهید"); return { url: b.data }; },
  "GET /api/admin/cats": t => { needAdmin(t); return [...db.cats].sort((a, b) => a.sort - b.sort).map(c => ({ ...c, n: db.products.filter(p => p.cat === c.id && p.active).length })); },
  "POST /api/admin/cats": (t, b) => {
    needAdmin(t); const keep = [];
    (b.cats || []).forEach((c, i) => { const name = String(c.name || "").trim(); if (!name) return; const x = c.id ? db.cats.find(y => y.id === +c.id) : null; if (x) { x.name = name; x.sort = i; keep.push(x.id); } else { const id = next("cats"); db.cats.push({ id, name, sort: i }); keep.push(id); } });
    db.cats = db.cats.filter(c => keep.includes(c.id)); db.products.forEach(p => { if (p.cat && !keep.includes(p.cat)) p.cat = null; }); return db.cats;
  },
  "GET /api/admin/products": t => { needAdmin(t); return [...db.products].sort((a, b) => b.active - a.active || a.id - b.id); },
  "POST /api/admin/products": (t, b) => {
    needAdmin(t); const name = String(b.name || "").trim(); if (!name) fail(400, "نام محصول لازم است");
    const prices = {}; for (const [k, v] of Object.entries(b.prices || {})) if (v !== "" && v != null) prices[k] = Math.round(+v);
    const f = { code: String(b.code || ""), name, cat: b.cat ? +b.cat : null, img: b.img || "", pack: Math.max(1, +b.pack || 1), unit: b.unit || "عدد", descr: b.descr || "", prices, active: b.active !== false, offer: Math.max(0, Math.min(9, Math.floor(+b.offer || 0))), updated: now() };
    let p = b.id ? db.products.find(x => x.id === +b.id) : null; if (p) Object.assign(p, f); else db.products.push(p = { id: next("products"), sort: 0, ...f }); return p;
  },
  "POST /api/admin/products/:id/delete": (t, b, id) => { needAdmin(t); const p = db.products.find(x => x.id === id); if (p) p.active = false; return { ok: true }; },
  "GET /api/admin/customers": t => { needAdmin(t); return db.users.filter(u => u.role === "customer").map(pub); },
  "POST /api/admin/customers": (t, b) => {
    needAdmin(t); const username = String(b.username || "").trim().toLowerCase(); if (!/^[a-z0-9_.]{3,30}$/.test(username)) fail(400, "نام کاربری: ۳ تا ۳۰ حرف انگلیسی یا عدد");
    if (db.users.some(u => u.username === username && u.id !== +b.id)) fail(400, "این نام کاربری گرفته شده");
    const f = { username, name: String(b.name || "").trim(), contact: b.contact || "", phone: b.phone || "", city: b.city || "", code: String(b.code || ""), level: b.level || "A", active: b.active !== false, margin: Math.max(0, Math.min(100, +b.margin || 0)), offer: /^(product|none|[1-9])$/.test(String(b.offer)) ? String(b.offer) : "product" };
    if (!f.name) fail(400, "نام فروشگاه لازم است");
    let u = b.id ? db.users.find(x => x.id === +b.id) : null;
    if (u) { Object.assign(u, f); if (b.password) u.pass = String(b.password); }
    else { if (String(b.password || "").length < 6) fail(400, "رمز حداقل ۶ حرف"); db.users.push(u = { id: next("users"), role: "customer", pass: String(b.password), created: now(), ...f }); }
    return pub(u);
  },
  "GET /api/admin/orders": t => {
    needAdmin(t);
    return db.orders.map(withU).sort((a, b) => b.id - a.id).map(o => ({ ...o, items: o.items.map(i => ({ ...i, sugOffer: suggestOffer(db.products.find(p => p.id === i.id)?.offer, o.uoffer) })) }));
  },
  "POST /api/admin/orders/:id/proforma": (t, b, id) => {
    needAdmin(t); const o = db.orders.find(x => x.id === id); if (!o) fail(404, "سفارش پیدا نشد"); if (o.status === "cancelled") fail(400, "سفارش لغو شده است");
    const pf = buildProforma(o.items, { offers: b.offers || {}, taxPct: b.taxPct ?? db.settings.taxPct, marginPct: b.marginPct ?? 0 }); pf.issued = new Date().toISOString();
    Object.assign(o, { proforma: pf, total: pf.total, status: o.status === "new" ? "confirmed" : o.status, seen: false, updated: now() }); return withU(o);
  },
  "POST /api/admin/orders/:id": (t, b, id) => {
    needAdmin(t); const o = db.orders.find(x => x.id === id); if (!o) fail(404, "سفارش پیدا نشد");
    if (b.status && ["new", "confirmed", "sent", "done", "cancelled"].includes(b.status)) o.status = b.status;
    if (b.addReturn) {
      const it = o.items.find(i => i.id === +b.addReturn.id), qty = Math.floor(+b.addReturn.qty);
      if (!it || !(qty > 0)) fail(400, "کالا و تعداد مرجوعی را درست وارد کنید");
      if (o.returns.filter(r => r.id === it.id).reduce((a, r) => a + r.qty, 0) + qty > it.qty) fail(400, "مرجوعی بیشتر از تعداد سفارش است");
      o.returns.push({ id: it.id, name: it.name, qty, amount: qty * it.price, note: b.addReturn.note || "", date: today() });
    }
    o.updated = now(); return withU(o);
  },
  "GET /api/admin/festivals": t => { needAdmin(t); return festivals(null, true); },
  "POST /api/admin/festivals": (t, b) => {
    needAdmin(t); const title = String(b.title || "").trim(); if (!title) fail(400, "عنوان جشنواره لازم است");
    const start = parseDate(b.start), end = parseDate(b.end); if (!start || !end) fail(400, "تاریخ شروع و پایان را مثل ۱۴۰۵/۰۹/۱۰ وارد کنید"); if (end < start) fail(400, "تاریخ پایان قبل از شروع است");
    const f = { title, poster: b.poster || "", descr: b.descr || "", min_amount: Math.max(0, Math.round(+b.min_amount || 0)), start, end, settle: b.settle || "", active: b.active !== false };
    let x = b.id ? db.festivals.find(y => y.id === +b.id) : null; if (x) Object.assign(x, f); else db.festivals.push(x = { id: next("festivals"), ...f }); return x;
  },
  "POST /api/admin/festivals/:id/delete": (t, b, id) => { needAdmin(t); db.festivals = db.festivals.filter(f => f.id !== id); return { ok: true }; },
  "GET /api/admin/festivals/:id/progress": (t, b, id) => { needAdmin(t); const f = db.festivals.find(x => x.id === id); return db.users.filter(u => u.role === "customer" && u.active).map(u => ({ id: u.id, name: u.name, city: u.city, bought: bought(u.id, f.start, f.end) })).sort((a, b) => b.bought - a.bought); },
  "POST /api/admin/import/read": () => fail(400, "ورود فایل اکسل و پی‌دی‌اف در نسخهٔ نمایشی گیت‌هاب فعال نیست؛ روی سرور اصلی کار می‌کند."),
  "GET /api/admin/imports": t => { needAdmin(t); return db.imports; },
};

export async function demoApi(method, path, body, token) {
  load();
  const u = new URL(path, "http://x");
  let key = method + " " + u.pathname, id = null;
  if (!R[key]) { const m = u.pathname.match(/^(.*\/)(\d+)(\/[a-z]+)?$/); if (m) { key = method + " " + m[1] + ":id" + (m[3] || ""); id = +m[2]; } }
  const fn = R[key]; if (!fn) fail(404, "پیدا نشد");
  const out = fn(token, body || {}, id);
  if (method === "POST") save();
  await new Promise(r => setTimeout(r, 120)); // feel like a network call
  return JSON.parse(JSON.stringify(out));
}
export const demoHint = () => `نسخهٔ نمایشی — اطلاعات نمونه فقط در همین مرورگر. مشتری: demo / demo1234 · مدیر: admin / admin1234`;
export { jalaliText };
