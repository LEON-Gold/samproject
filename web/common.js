// Shared by the customer app and the admin panel: API calls, Persian numbers/dates, the printable proforma.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// admin and customer keep separate logins, so both can be open side by side in one browser
const KEY = /\/admin\//.test(location.pathname + "/") ? "sam.admin.token" : "sam.token";
export const token = { get: () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }, set: t => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} } };

// GitHub Pages has no server: there the app runs on a demo backend inside the browser (demo.js), with sample data.
export const DEMO = location.hostname.endsWith("github.io") || /[?&]demo\b/.test(location.search);
let demoMod = null;
const demo = () => demoMod || (demoMod = import(new URL("./demo.js?v=6", import.meta.url).href));
if (DEMO) (async () => {
  const m = await demo();
  if (document.readyState === "loading") await new Promise(r => addEventListener("DOMContentLoaded", r));
  const bar = document.createElement("div");
  bar.className = "demo-bar"; bar.setAttribute("role", "note");
  bar.innerHTML = `<span>نسخهٔ نمایشی (اطلاعات نمونه، فقط در همین مرورگر) · مشتری: <bdi dir="ltr">demo / demo1234</bdi> · مدیر: <bdi dir="ltr">admin / admin1234</bdi></span><button type="button">شروع از اول</button>`;
  bar.querySelector("button").onclick = () => { if (confirm("اطلاعات نمونه به حالت اول برگردد؟")) { m.resetDemo(); location.reload(); } };
  document.body.prepend(bar);
})();

export async function api(path, body) {
  if (DEMO) {
    const m = await demo();
    try { return await m.demoApi(body ? "POST" : "GET", path, body, token.get()); }
    catch (e) { if (e.status === 401 && path !== "/api/login") { token.set(""); location.reload(); } throw new Error(e.message || "خطا"); }
  }
  const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token.get() ? { Authorization: "Bearer " + token.get() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await r.json(); } catch {}
  if (r.status === 401 && path !== "/api/login") { token.set(""); location.reload(); }
  if (!r.ok) throw new Error(data.error || "ارتباط با سرور برقرار نشد");
  return data;
}

const nf = new Intl.NumberFormat("fa-IR");
export const fa = n => n == null || n === "" ? "—" : nf.format(n);
export const money = (n, cur) => n == null ? "—" : nf.format(n) + (cur ? " " + cur : "");
export const faDigits = s => String(s ?? "").replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);

// ISO date → «۳ آذر ۱۴۰۵» / «۱۴۰۵/۰۹/۰۳»
export const faDate = (iso, long) => {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00Z" : iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (long) return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Tehran" }).format(d);
  // short form is isolated (LRI…PDI) so «۱۴۰۵/۰۹/۰۳» stays in one piece next to Persian words
  return "⁦" + new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tehran" }).format(d) + "⁩";
};
export const latin = s => String(s ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

export function toast(msg, bad) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(t._h); t._h = setTimeout(() => t.className = "toast", 3200);
}

// Count-up (owner, 2026-11-24): when a tab opens, its numbers roll from ۰ up to their value.
// Works on text nodes that are only a number (۱۹۹٬۰۰۰), so dates, codes and mixed text are left alone.
// One rAF loop for all numbers on screen; writes nodeValue only (tabular digits keep the width steady).
const counted = new WeakSet();
// a number, optionally followed by its unit («۸٬۰۸۲٬۰۰۰ تومان», «۱۲ روز», «۴۰٪»)
const NUM_ONLY = /^(\s*)([۰-۹][۰-۹٬,]*)(\s*(?:تومان|ریال|روز|٪|%)?\s*)$/;
const SKIP = ".badge, .tabs, .step, .sheet, input, textarea, select, script, style, #print";
function countNodes(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
  for (let n = tw.nextNode(); n && list.length < 80; n = tw.nextNode()) {
    if (counted.has(n) || !NUM_ONLY.test(n.nodeValue) || n.parentElement?.closest(SKIP)) continue;
    const [, pre, digits, post] = n.nodeValue.match(NUM_ONLY), target = +latin(digits).replace(/[٬,]/g, "");
    if (!(target > 0)) continue;
    counted.add(n);
    list.push({ n, target, pre, post, grouped: /[٬,]/.test(digits) });
  }
  if (!list.length) return;
  const fmt = (x, g) => g ? nf.format(x) : faDigits(x);
  const dur = 900, t0 = performance.now(), ease = t => 1 - Math.pow(1 - t, 4); // fast start, soft landing
  for (const x of list) x.n.nodeValue = x.pre + fmt(0, x.grouped) + x.post;
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), k = ease(t);
    for (const x of list) x.n.nodeValue = x.pre + fmt(t < 1 ? Math.round(x.target * k) : x.target, x.grouped) + x.post;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// Watch a container for a short while after a tab opens, so numbers that arrive with the data count too.
let watch = null;
export function countUpOnEnter(root, ms = 2500) {
  if (watch) watch.disconnect();
  countNodes(root);
  watch = new MutationObserver(() => countNodes(root));
  watch.observe(root, { childList: true, subtree: true });
  setTimeout(() => { if (watch) { watch.disconnect(); watch = null; } }, ms);
}

export const STATUS = { open: "پیش‌فاکتور", new: "در صف تایید", confirmed: "پیش‌فاکتور صادر شد", sent: "ارسال شده", done: "تحویل شده", cancelled: "لغو شده" };

// Printable proforma / order. On iPhone, «چاپ» → share → save as PDF.
export function printDoc(o, s, cust) {
  // o: an order (with its admin-issued proforma), or an imported invoice ({ title, no, date, items, total })
  const pf = o.proforma;
  const title = o.title || (pf || o.kind === "proforma" ? "پیش‌فاکتور" : "سفارش");
  const no = o.no != null ? faDigits(o.no) : fa(o.id), when = o.date ? faDate(o.date) : o.date_raw ? faDigits(o.date_raw) : faDate(pf ? pf.issued : o.updated || o.created);
  const items = pf ? pf.lines : o.items, hasCode = items.some(i => i.code), span = hasCode ? 5 : 4;
  let k = 0;
  const row = (i, offer) => `<tr${offer ? ' class="pd-offer"' : ""}><td>${offer ? "" : fa(++k)}</td>${hasCode ? `<td>${esc(faDigits(i.code || ""))}</td>` : ""}<td class="l">${offer ? `آفر ${offer} — ` : ""}${esc(i.name)}</td>`
    + `<td>${offer ? fa(i.free) : i.qty != null ? fa(i.qty) : ""}</td><td>${offer ? "—" : i.price != null ? fa(i.price) : ""}</td><td>${offer ? "—" : fa(i.sum)}</td></tr>`;
  const rows = items.map(i => row(i) + (pf && i.free ? row(i, faDigits(i.offer) + " به ۱") : "")).join("");
  const foot = pf
    ? `<tr><td colspan="${span}">جمع کالا</td><td>${fa(pf.subtotal)}</td></tr>
       <tr><td colspan="${span}">مالیات ${fa(pf.taxPct)}٪</td><td>${fa(pf.tax)}</td></tr>
       ${pf.marginPct ? `<tr><td colspan="${span}">جمع با مالیات</td><td>${fa(pf.gross)}</td></tr><tr><td colspan="${span}">کسر مارجین ${fa(pf.marginPct)}٪</td><td>${fa(pf.margin)}</td></tr>` : ""}
       <tr class="pd-total"><td colspan="${span}">مبلغ قابل پرداخت</td><td>${fa(pf.total)}</td></tr>`
    : `<tr><td colspan="${span}">جمع کل</td><td>${fa(o.total)}</td></tr>`;
  let el = $("#print"); if (!el) { el = document.createElement("div"); el.id = "print"; document.body.append(el); }
  el.innerHTML = `<div class="pd">
    <header><div><b class="pd-brand">${esc(s.brand)}</b>${s.phone ? `<span>تلفن: ${esc(faDigits(s.phone))}</span>` : ""}</div>
      <div class="pd-meta"><h1>${title}</h1><span>شماره: ${esc(no)}</span><span>تاریخ: ${when}</span></div></header>
    <div class="pd-to">خریدار: <b>${esc(cust.name)}</b>${cust.city ? " — " + esc(cust.city) : ""}${cust.phone ? " — " + esc(faDigits(cust.phone)) : ""}</div>
    <table><thead><tr><th>ردیف</th>${hasCode ? "<th>کد</th>" : ""}<th class="l">شرح کالا</th><th>تعداد</th><th>فی (${esc(s.currency)})</th><th>جمع (${esc(s.currency)})</th></tr></thead><tbody>${rows}</tbody>
    <tfoot>${foot}</tfoot></table>
    ${pf && pf.freeTotal ? `<p>جمع اقلام آفر: ${fa(pf.freeTotal)} عدد (رایگان)</p>` : ""}
    ${o.note ? `<p>توضیح: ${esc(o.note)}</p>` : ""}
    ${pf && s.proformaNote ? `<p class="pd-note">${esc(s.proformaNote)}</p>` : ""}
  </div>`;
  document.title = `${title} ${o.no ?? o.id} — ${s.brand}`;
  setTimeout(() => window.print(), 50);
}

// Resize a picked photo in the browser before upload (max 1400px JPEG) so phones don't send 10 MB files.
export function shrinkImage(file, max = 1400) {
  return new Promise((ok, bad) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => bad(new Error("عکس باز نشد"));
    img.src = url;
  });
}
export const fileB64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
