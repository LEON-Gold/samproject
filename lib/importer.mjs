// Turns rows read from a price list / invoice / balance file into a preview, then into saved data.
// Nothing is written until the team looks at the preview and confirms (owner, 2026-11-24).
import { latinDigits, parseDate } from "./jalali.mjs";

export const norm = s => latinDigits(s).replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[‌‏‎ً-ْـ]/g, "")
  .replace(/[\s\-_.\/()]+/g, " ").trim().toLowerCase();
export const normCode = s => latinDigits(s).replace(/[\s\-_.\/]/g, "").toUpperCase();

// "۱٬۲۵۰٬۰۰۰ ریال" → 1250000; "(25,000)" or "25,000-" → -25000; unreadable → null
export function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = latinDigits(v).replace(/[٬,،\s]/g, "").replace(/٫/g, ".").replace(/ریال|تومان|ت|ر|IRR|IRT/gi, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^-/.test(s)) { neg = true; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return neg ? -Number(s) : Number(s);
}

const KEYS = {
  code: ["کد کالا", "کد محصول", "کد", "code", "sku", "بارکد"],
  name: ["نام کالا", "نام محصول", "شرح کالا", "شرح", "عنوان", "نام", "محصول", "کالا", "name"],
  price: ["قیمت", "فی", "مبلغ واحد", "price"],
  cust: ["کد مشتری", "کد طرف حساب", "کد حساب", "مشتری", "طرف حساب", "نمایندگی", "نام مشتری", "customer", "کد", "نام"],
  no: ["شماره فاکتور", "شماره فاکتور فروش", "شماره سند", "شماره", "invoice", "no"],
  date: ["تاریخ", "date"],
  amount: ["مبلغ کل", "جمع کل", "مبلغ فاکتور", "مبلغ", "جمع", "total", "amount"],
  kind: ["نوع", "نوع فاکتور", "type"],
  balance: ["مانده", "مانده حساب", "balance"],
  debit: ["بدهکار", "debit"],
  credit: ["بستانکار", "credit"],
};

// Find the header row (the first row with ≥2 known words) and guess which column holds what.
export function guess(rows, fields) {
  let best = { row: 0, score: -1, map: {} };
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(c => norm(c));
    const map = {}; let score = 0;
    for (const f of fields) {
      const keys = KEYS[f] || [];
      for (const k of keys) {
        const i = cells.findIndex((c, i) => c && !Object.values(map).includes(i) && (c === norm(k) || c.startsWith(norm(k))));
        if (i >= 0) { map[f] = i; score++; break; }
      }
    }
    if (score > best.score) best = { row: r, score, map };
  }
  return { headerRow: best.score >= 1 ? best.row : -1, map: best.map };
}

const body = (rows, headerRow) => rows.slice(headerRow + 1).map((r, i) => ({ r, line: headerRow + 2 + i })).filter(x => x.r.some(c => String(c).trim()));

// ---------- price list ----------
// map: { code?, name?, prices: { levelKey: col } }, factor: multiply prices (e.g. 0.1 rial → toman)
export function pricePreview(rows, { headerRow = 0, map, factor = 1 }, products) {
  const byCode = new Map(), byName = new Map();
  for (const p of products) { if (p.code) byCode.set(normCode(p.code), p); byName.set(norm(p.name), p); }
  const items = [], seen = new Set();
  for (const { r, line } of body(rows, headerRow)) {
    const code = map.code != null ? String(r[map.code] ?? "").trim() : "";
    const name = map.name != null ? String(r[map.name] ?? "").replace(/\s+/g, " ").trim() : "";
    const prices = {};
    for (const [lv, col] of Object.entries(map.prices || {})) { const n = num(r[col]); if (n != null && n > 0) prices[lv] = Math.round(n * factor); }
    if (!Object.keys(prices).length || (!code && !name)) continue; // titles, totals, empty lines
    const p = (code && byCode.get(normCode(code))) || (name && byName.get(norm(name))) || null;
    if (p) seen.add(p.id);
    let status = "new";
    if (p) status = Object.entries(prices).some(([lv, v]) => (p.prices || {})[lv] !== v) ? "changed" : "same";
    items.push({ line, code, name, prices, status, pid: p?.id ?? null, old: p ? p.prices || {} : null, pname: p?.name });
  }
  const missing = products.filter(p => p.active && !seen.has(p.id)).map(p => ({ id: p.id, code: p.code, name: p.name }));
  const count = s => items.filter(i => i.status === s).length;
  return { items, missing, summary: { new: count("new"), changed: count("changed"), same: count("same"), missing: missing.length } };
}

// ---------- invoices ----------
// map: { cust, no, date, amount, kind? }  custBy: "code" | "name"
export function matchCustomer(v, custBy, customers) {
  const s = String(v ?? "").trim(); if (!s) return null;
  if (custBy === "name") return customers.find(c => norm(c.name) === norm(s)) || null;
  return customers.find(c => c.code && normCode(c.code) === normCode(s)) || customers.find(c => norm(c.name) === norm(s)) || null;
}

export function invoicePreview(rows, { headerRow = 0, map, custBy = "code", factor = 1 }, customers) {
  const groups = new Map(), bad = [];
  for (const { r, line } of body(rows, headerRow)) {
    const no = latinDigits(r[map.no] ?? "").trim();
    const amt = num(r[map.amount]);
    const custRaw = String(r[map.cust] ?? "").trim();
    if (!no || amt == null || !custRaw) { if (no || custRaw) bad.push({ line, why: !no ? "شماره ندارد" : amt == null ? "مبلغ ندارد" : "مشتری ندارد" }); continue; }
    const kindTxt = map.kind != null ? norm(r[map.kind]) : "";
    const kind = /مرجوع|برگشت|return/.test(kindTxt) || amt < 0 ? "return" : "sale";
    const key = kind + ":" + no;
    const g = groups.get(key) || { no, kind, cust: custRaw, date: parseDate(map.date != null ? r[map.date] : ""), dateRaw: map.date != null ? String(r[map.date] ?? "") : "", amount: 0, lines: 0, line };
    g.amount += Math.abs(amt) * factor; g.lines++;
    groups.set(key, g);
  }
  const items = [...groups.values()].map(g => { const c = matchCustomer(g.cust, custBy, customers); return { ...g, amount: Math.round(g.amount), uid: c?.id ?? null, uname: c?.name ?? null }; });
  const unmatched = [...new Set(items.filter(i => !i.uid).map(i => i.cust))];
  return { items, bad, unmatched, summary: { invoices: items.filter(i => i.kind === "sale").length, returns: items.filter(i => i.kind === "return").length, unmatched: unmatched.length, bad: bad.length } };
}

// ---------- balances ----------
// map: { cust, balance } or { cust, debit, credit }. Positive = the customer owes SAM (بدهکار).
export function balancePreview(rows, { headerRow = 0, map, custBy = "code", factor = 1 }, customers) {
  const items = [], bad = [];
  for (const { r, line } of body(rows, headerRow)) {
    const custRaw = String(r[map.cust] ?? "").trim(); if (!custRaw) continue;
    let bal = null;
    if (map.balance != null) bal = num(r[map.balance]);
    else if (map.debit != null || map.credit != null) bal = (num(r[map.debit]) || 0) - (num(r[map.credit]) || 0);
    if (bal == null) { bad.push({ line, why: "مانده ندارد" }); continue; }
    const c = matchCustomer(custRaw, custBy, customers);
    items.push({ line, cust: custRaw, balance: Math.round(bal * factor), uid: c?.id ?? null, uname: c?.name ?? null });
  }
  return { items, bad, unmatched: items.filter(i => !i.uid).map(i => i.cust), summary: { rows: items.length, unmatched: items.filter(i => !i.uid).length } };
}
