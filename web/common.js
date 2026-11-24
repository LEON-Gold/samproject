// Shared by the customer app and the admin panel: API calls, Persian numbers/dates, the printable proforma.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// admin and customer keep separate logins, so both can be open side by side in one browser
const KEY = location.pathname.startsWith("/admin") ? "sam.admin.token" : "sam.token";
export const token = { get: () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }, set: t => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} } };

export async function api(path, body) {
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

export const STATUS = { open: "پیش‌فاکتور", new: "ثبت شده", confirmed: "تایید شده", sent: "ارسال شده", done: "تحویل شده", cancelled: "لغو شده" };

// Printable proforma / order. On iPhone, «چاپ» → share → save as PDF.
export function printDoc(o, s, cust) {
  // o: an order/proforma, or an imported invoice ({ title, no, date, items, total })
  const title = o.title || (o.kind === "proforma" ? "پیش‌فاکتور" : "سفارش");
  const no = o.no != null ? faDigits(o.no) : fa(o.id), when = o.date ? faDate(o.date) : o.date_raw ? faDigits(o.date_raw) : faDate(o.updated || o.created);
  const hasCode = o.items.some(i => i.code);
  const rows = o.items.map((i, k) => `<tr><td>${fa(k + 1)}</td>${hasCode ? `<td>${esc(faDigits(i.code || ""))}</td>` : ""}<td class="l">${esc(i.name)}</td><td>${i.qty != null ? fa(i.qty) : ""}</td><td>${i.price != null ? fa(i.price) : ""}</td><td>${fa(i.sum)}</td></tr>`).join("");
  let el = $("#print"); if (!el) { el = document.createElement("div"); el.id = "print"; document.body.append(el); }
  el.innerHTML = `<div class="pd">
    <header><div><b class="pd-brand">${esc(s.brand)}</b>${s.phone ? `<span>تلفن: ${esc(faDigits(s.phone))}</span>` : ""}</div>
      <div class="pd-meta"><h1>${title}</h1><span>شماره: ${esc(no)}</span><span>تاریخ: ${when}</span></div></header>
    <div class="pd-to">خریدار: <b>${esc(cust.name)}</b>${cust.city ? " — " + esc(cust.city) : ""}${cust.phone ? " — " + esc(faDigits(cust.phone)) : ""}</div>
    <table><thead><tr><th>ردیف</th>${hasCode ? "<th>کد</th>" : ""}<th class="l">شرح کالا</th><th>تعداد</th><th>فی (${esc(s.currency)})</th><th>جمع (${esc(s.currency)})</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${hasCode ? 5 : 4}">جمع کل</td><td>${fa(o.total)}</td></tr></tfoot></table>
    ${o.note ? `<p>توضیح: ${esc(o.note)}</p>` : ""}
    ${o.kind === "proforma" && s.proformaNote ? `<p class="pd-note">${esc(s.proformaNote)}</p>` : ""}
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
