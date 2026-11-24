// Makes sample accounting files to try the importers: invoices and balances as .xlsx, plus HTML that Chrome prints to PDF.
// All numbers are made up for testing. Customers 1001 / 1002 are the demo customers.
// Run: node tools/sample-files.mjs <out-dir>
import fs from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { jalaliText } from "../lib/jalali.mjs";

const out = process.argv[2] || "samples";
fs.mkdirSync(out, { recursive: true });

// ---- minimal .xlsx writer (inline strings) ----
function zip(files) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), nb = Buffer.from(name), c32 = crc(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(c32, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(c32, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, data); central.push(c, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const x = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function xlsx(sheetName, rows) {
  const col = i => String.fromCharCode(65 + i);
  const data = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => typeof v === "number" ? `<c r="${col(j)}${i + 1}"><v>${v}</v></c>` : `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t>${x(v)}</t></is></c>`).join("")}</row>`).join("");
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView rightToLeft="1"/></bookViews><sheets><sheet name="${x(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>${data}</sheetData></worksheet>`,
  });
}

// ---- sample data (made up) ----
const day = n => jalaliText(new Date(Date.now() - n * 864e5).toISOString().slice(0, 10));
const lines = [
  // [customer code, customer name, invoice no, days ago, item, qty, unit price, kind]
  ["1001", "فروشگاه نمونه", "3101", 40, "فوم اصلاح (نمونه)", 24, 185000, "فروش"],
  ["1001", "فروشگاه نمونه", "3101", 40, "شامپو مو (نمونه)", 12, 240000, "فروش"],
  ["1002", "عمده‌فروشی نمونه", "3102", 33, "واکس مو (نمونه)", 48, 207000, "فروش"],
  ["1001", "فروشگاه نمونه", "3107", 19, "دئودورانت (نمونه)", 24, 175000, "فروش"],
  ["1001", "فروشگاه نمونه", "3107", 19, "کرم مرطوب‌کننده (نمونه)", 12, 290000, "فروش"],
  ["1002", "عمده‌فروشی نمونه", "3110", 12, "شامپو بدن (نمونه)", 60, 244000, "فروش"],
  ["1002", "عمده‌فروشی نمونه", "B-12", 9, "واکس مو (نمونه)", 6, 207000, "مرجوعی"],
  ["1001", "فروشگاه نمونه", "3118", 4, "افترشیو (نمونه)", 18, 320000, "فروش"],
  ["1001", "فروشگاه نمونه", "B-15", 2, "فوم اصلاح (نمونه)", 3, 185000, "مرجوعی"],
];
const head = ["کد مشتری", "نام مشتری", "شماره فاکتور", "تاریخ", "شرح کالا", "تعداد", "فی", "مبلغ کل", "نوع"];
const rows = lines.map(([c, n, no, d, item, q, p, k]) => [c, n, no, day(d), item, q, p, q * p, k]);
const sale = c => rows.filter(r => r[0] === c && r[8] === "فروش").reduce((a, r) => a + r[7], 0) - rows.filter(r => r[0] === c && r[8] === "مرجوعی").reduce((a, r) => a + r[7], 0);
const bal = [["کد", "نام مشتری", "بدهکار", "بستانکار"], ["1001", "فروشگاه نمونه", Math.round(sale("1001") * 0.4), 0], ["1002", "عمده‌فروشی نمونه", 0, 2500000]];

fs.writeFileSync(path.join(out, "فاکتورهای-نمونه.xlsx"), xlsx("فاکتورها", [["گزارش فاکتورهای فروش (نمونهٔ آزمایشی)"], head, ...rows]));
fs.writeFileSync(path.join(out, "مانده-حساب-نمونه.xlsx"), xlsx("مانده", [["مانده حساب مشتریان تا " + day(0) + " (نمونهٔ آزمایشی)"], ...bal]));

const fmt = n => typeof n === "number" ? n.toLocaleString("en-US") : n;
const page = (title, h, body) => `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>body{font-family:Tahoma,sans-serif;font-size:11px;margin:24px}h2{font-size:15px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px 8px;text-align:center}th{background:#eee}</style>
<h2>${x(title)}</h2><table><tr>${h.map(c => `<th>${x(c)}</th>`).join("")}</tr>${body.map(r => `<tr>${r.map(c => `<td>${x(fmt(c))}</td>`).join("")}</tr>`).join("")}</table></html>`;
fs.writeFileSync(path.join(out, "invoices.html"), page("گزارش فاکتورهای فروش (نمونهٔ آزمایشی)", head, rows));
fs.writeFileSync(path.join(out, "balances.html"), page("مانده حساب مشتریان تا " + day(0) + " (نمونهٔ آزمایشی)", bal[0], bal.slice(1)));
console.log("ok", out);
