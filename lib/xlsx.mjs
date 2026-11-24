// A small .xlsx / .csv reader with no dependencies: every sheet → rows of cell values.
// .xlsx is a zip of XML files; we read the zip directory, inflate the parts we need and walk the cells.
import { inflateRawSync } from "node:zlib";

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    files[name] = () => (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    p += 46 + nl + el + cl;
  }
  return files;
}

const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
const texts = s => [...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join("");
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export function readXlsx(buf) {
  const z = unzip(buf);
  const shared = z["xl/sharedStrings.xml"] ? [...z["xl/sharedStrings.xml"]().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1])) : [];
  const wb = z["xl/workbook.xml"]();
  const rels = z["xl/_rels/workbook.xml.rels"] ? z["xl/_rels/workbook.xml.rels"]() : "";
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/Id="([^"]+)"/)?.[1], t = m[1].match(/Target="([^"]+)"/)?.[1];
    if (id && t) target[id] = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unxml(m[1].match(/name="([^"]*)"/)?.[1] || "Sheet");
    const rid = m[1].match(/r:id="([^"]+)"/)?.[1];
    const path = target[rid] || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    if (!z[path]) continue;
    const rows = [];
    for (const r of z[path]().matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] || "";
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1], t = attrs.match(/t="([^"]+)"/)?.[1];
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = "";
        if (t === "s") val = shared[+v] ?? "";
        else if (t === "inlineStr") val = texts(body);
        else if (t === "str" || t === "e") val = v != null ? unxml(v) : "";
        else if (t === "b") val = v === "1";
        else if (v != null) val = Number(v);
        row[ref ? colIndex(ref) : row.length] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

export function readCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [{ name: "CSV", rows: rows.filter(r => r.some(c => String(c).trim())) }];
}
