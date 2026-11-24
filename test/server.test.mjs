import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-"));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASS = "admin-pass";
const { openDb, createApp, ensureAdmin } = await import("../server.mjs");
const { seed } = await import("../tools/demo.mjs");
const { parseDate, jalaliText } = await import("../lib/jalali.mjs");
const { readXlsx } = await import("../lib/xlsx.mjs");
const { num } = await import("../lib/importer.mjs");

const db = openDb(path.join(dir, "t.db"));
ensureAdmin(db); seed(db);
const srv = http.createServer(createApp(db)).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (p, body, tok) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) , _arr: null };
};
const get = async (p, tok) => { const r = await fetch(base + p, { headers: { Authorization: "Bearer " + tok } }); return r.json(); };
const login = async (u, p) => (await call("/api/login", { u, p })).token;

// a tiny .xlsx built by hand (stored + deflated parts), to test the reader without any library
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text)), nb = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, data); central.push(c, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const xlsx = rows => {
  const strs = [], cell = (v, ref) => typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${strs.push(v) - 1}</v></c>`;
  const sheet = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, String.fromCharCode(65 + j) + (i + 1))).join("")}</row>`).join("");
  return zip({
    "xl/workbook.xml": `<workbook><sheets><sheet name="لیست" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<sst>${strs.map(s => `<si><t>${s}</t></si>`).join("")}</sst>`,
  });
};

test("dates and numbers", () => {
  assert.equal(parseDate("۱۴۰۵/۰۹/۰۳"), "2026-11-24");
  assert.equal(parseDate("05/9/3"), "2026-11-24");
  assert.equal(jalaliText("2026-11-24"), "1405/09/03");
  assert.equal(parseDate("2026-03-21"), "2026-03-21");
  assert.equal(num("۱٬۲۵۰٬۰۰۰ ریال"), 1250000);
  assert.equal(num("(25,000)"), -25000);
  assert.equal(num("—"), null);
});

test("xlsx reader", () => {
  const s = readXlsx(xlsx([["کد", "نام کالا", "قیمت"], ["S-101", "فوم", 190000]]));
  assert.equal(s[0].name, "لیست");
  assert.deepEqual(s[0].rows[1], ["S-101", "فوم", 190000]);
});

test("login, catalog prices by level, no prices without login", async () => {
  assert.equal((await call("/api/catalog")).status, 401);
  assert.equal((await call("/api/login", { u: "demo", p: "wrong" })).status, 401);
  const a = await login("demo", "demo1234"), b = await login("demo2", "demo1234");
  const ca = await get("/api/catalog", a), cb = await get("/api/catalog", b);
  const pa = ca.products.find(p => p.code === "S-101"), pb = cb.products.find(p => p.code === "S-101");
  assert.equal(pa.price, 185000); assert.ok(pb.price > pa.price);
  assert.equal(ca.cats.length, 5);
  assert.ok(!("prices" in pa), "a customer never sees other levels' prices");
});

test("proforma → order, prices come from the server", async () => {
  const t = await login("demo", "demo1234");
  const { products } = await get("/api/catalog", t);
  const pf = await call("/api/orders", { kind: "proforma", items: [{ id: products[0].id, qty: 2, price: 1 }] }, t);
  assert.equal(pf.kind, "proforma"); assert.equal(pf.total, products[0].price * 2);
  const o = await call(`/api/orders/${pf.id}/submit`, {}, t);
  assert.equal(o.kind, "order"); assert.equal(o.status, "new");
  const admin = await login("admin", "admin-pass");
  assert.equal((await call(`/api/orders/${pf.id}/submit`, {}, admin)).status, 404, "another user can't touch it");
  const r = await call(`/api/admin/orders/${o.id}`, { addReturn: { id: products[0].id, qty: 1, note: "شکسته" } }, admin);
  assert.equal(r.returns[0].amount, products[0].price);
  assert.equal((await call(`/api/admin/orders/${o.id}`, { addReturn: { id: products[0].id, qty: 5 } }, admin)).status, 400);
  const rep = (await get("/api/admin/report", admin)).find(x => x.name === "فروشگاه نمونه");
  assert.equal(rep.sales, o.total); assert.equal(rep.returns, products[0].price); assert.equal(rep.source, "orders");
});

test("customers can't reach the admin api", async () => {
  const t = await login("demo", "demo1234");
  assert.equal((await call("/api/admin/products", null, t)).status, 403);
});

test("price list import: preview, then apply", async () => {
  const admin = await login("admin", "admin-pass");
  const file = xlsx([["لیست قیمت سام"], ["ردیف", "کد کالا", "نام کالا", "قیمت نمایندگی", "قیمت عمده"], [1, "S-101", "فوم اصلاح", "199,000", 210000], [2, "S-102", "ژل اصلاح", 210000, 222000], [3, "N-900", "محصول تازه", 99000, 105000]]);
  const read = await call("/api/admin/import/read", { kind: "prices", name: "list.xlsx", data: file.toString("base64") }, admin);
  const sh = read.sheets[0];
  assert.equal(sh.guess.headerRow, 1); assert.equal(sh.guess.map.code, 1); assert.equal(sh.guess.map.name, 2);
  const req = { kind: "prices", rows: sh.rows, headerRow: 1, map: { code: 1, name: 2, prices: { A: 3, B: 4 } } };
  const pv = await call("/api/admin/import/preview", req, admin);
  assert.equal(pv.summary.changed, 2); assert.equal(pv.summary.new, 1);
  assert.ok(pv.summary.missing >= 8);
  const before = (await get("/api/admin/products", admin)).length;
  await call("/api/admin/import/apply", { ...req, createNew: true }, admin);
  const after = await get("/api/admin/products", admin);
  assert.equal(after.length, before + 1);
  const p = after.find(p => p.code === "S-101");
  assert.equal(p.prices.A, 199000); assert.equal(p.prices.B, 210000); assert.ok(p.prices.C, "levels not in the file are kept");
});

test("invoice + balance import → customer account, report and festival progress", async () => {
  const admin = await login("admin", "admin-pass");
  const d = jalaliText(new Date().toISOString().slice(0, 10));
  const rows = [["کد مشتری", "شماره فاکتور", "تاریخ", "شرح", "مبلغ", "نوع"], ["1001", "5001", d, "فوم", 30000000, "فروش"], ["1001", "5001", d, "ژل", 25000000, "فروش"], ["1001", "R-7", d, "برگشت", 4000000, "مرجوعی"], ["9999", "5002", d, "", 1000, "فروش"]];
  const pv = await call("/api/admin/import/preview", { kind: "invoices", rows, headerRow: 0, map: { cust: 0, no: 1, date: 2, amount: 4, kind: 5 } }, admin);
  assert.equal(pv.summary.invoices, 2); assert.equal(pv.summary.returns, 1); assert.deepEqual(pv.unmatched, ["9999"]);
  assert.equal(pv.items.find(i => i.no === "5001").amount, 55000000, "item lines of one invoice are added up");
  await call("/api/admin/import/apply", { kind: "invoices", rows, headerRow: 0, map: { cust: 0, no: 1, date: 2, amount: 4, kind: 5 } }, admin);
  await call("/api/admin/import/apply", { kind: "invoices", rows, headerRow: 0, map: { cust: 0, no: 1, date: 2, amount: 4, kind: 5 } }, admin); // re-import doesn't double
  await call("/api/admin/import/apply", { kind: "balances", rows: [["کد", "بدهکار", "بستانکار"], ["1001", "12,500,000", 0]], headerRow: 0, map: { cust: 0, debit: 1, credit: 2 }, asOf: d }, admin);
  const t = await login("demo", "demo1234");
  const acc = await get("/api/account", t);
  assert.equal(acc.invoices.length, 2); assert.equal(acc.balance.amount, 12500000);
  const f = acc.festivals[0];
  assert.equal(f.bought, 51000000, "festival progress uses real invoices minus returns");
  const rep = (await get("/api/admin/report", admin)).find(x => x.code === "1001");
  assert.equal(rep.source, "invoices"); assert.equal(rep.sales, 55000000); assert.equal(rep.balance, 12500000);
  const demo2 = await login("demo2", "demo1234");
  assert.equal((await get("/api/account", demo2)).invoices.length, 0, "a customer sees only their own invoices");
});

test("festival dates in Jalali, end before start refused", async () => {
  const admin = await login("admin", "admin-pass");
  const f = await call("/api/admin/festivals", { title: "جشنواره زمستان", start: "۱۴۰۵/۱۰/۰۱", end: "۱۴۰۵/۱۰/۳۰", min_amount: 100000000, settle: "چک ۶۰ روزه" }, admin);
  assert.equal(f.start, "2026-12-22");
  assert.equal((await call("/api/admin/festivals", { title: "x", start: "1405/10/30", end: "1405/10/01" }, admin)).status, 400);
});

test.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("Persian PDF price list (visual-order text) is read in reading order", async () => {
  const { readPdf } = await import("../lib/pdf.mjs");
  const { guess, pricePreview } = await import("../lib/importer.mjs");
  const rows = (await readPdf(fs.readFileSync(new URL("./fixtures/pricelist-fa.pdf", import.meta.url))))[0].rows;
  assert.equal(rows[0][0], "لیست قیمت محصولات");
  const g = guess(rows, ["code", "name", "price"]);
  assert.deepEqual(g, { headerRow: 1, map: { code: 1, name: 2, price: 3 } });
  const pv = pricePreview(rows, { headerRow: 1, map: { code: 1, name: 2, prices: { A: 3 } } }, [{ id: 1, code: "H-201", name: "شامپو", prices: { A: 1 }, active: true }]);
  assert.equal(pv.items.find(i => i.code === "H-201").status, "changed");
  assert.equal(pv.items.find(i => i.code === "Z-900").name, "کرم دست");
  assert.equal(rows[2][2], "فوم اصلاح (نمونه)", "brackets come back the right way round");
});

test("invoice and balance PDFs are read and matched", async () => {
  const { readPdf } = await import("../lib/pdf.mjs");
  const { guess, invoicePreview, balancePreview } = await import("../lib/importer.mjs");
  const custs = [{ id: 1, name: "فروشگاه نمونه", code: "1001" }, { id: 2, name: "عمده‌فروشی نمونه", code: "1002" }];
  const inv = (await readPdf(fs.readFileSync(new URL("./fixtures/invoices-fa.pdf", import.meta.url))))[0].rows;
  const gi = guess(inv, ["cust", "no", "date", "amount", "kind", "item", "qty", "unit"]);
  assert.deepEqual(gi.map, { cust: 0, no: 2, date: 3, amount: 7, kind: 8, item: 4, qty: 5, unit: 6 });
  const pi = invoicePreview(inv, { headerRow: gi.headerRow, map: gi.map }, custs);
  assert.deepEqual(pi.summary, { invoices: 5, returns: 2, unmatched: 0, bad: 0 });
  const i3101 = pi.items.find(i => i.no === "3101");
  assert.equal(i3101.amount, 24 * 185000 + 12 * 240000);
  assert.deepEqual(i3101.items[0], { name: "فوم اصلاح (نمونه)", qty: 24, price: 185000, sum: 4440000 }, "item lines are kept for printing");
  const bal = (await readPdf(fs.readFileSync(new URL("./fixtures/balances-fa.pdf", import.meta.url))))[0].rows;
  const gb = guess(bal, ["cust", "balance", "debit", "credit"]);
  assert.deepEqual(gb.map, { cust: 0, debit: 2, credit: 3 });
  const pb = balancePreview(bal, { headerRow: gb.headerRow, map: gb.map }, custs);
  assert.equal(pb.items.find(i => i.uid === 2).balance, -2500000);
});
