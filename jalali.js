// Jalali (Persian) ⇄ Gregorian dates. Invoices and festivals are typed in Jalali («۱۴۰۵/۰۹/۰۳»); we store ISO.
const div = (a, b) => Math.trunc(a / b);

export function toJalali(gy, gm, gd) {
  const g = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + g[gm - 1];
  let jy = -1595 + 33 * div(days, 12053); days %= 12053;
  jy += 4 * div(days, 1461); days %= 1461;
  if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

export function toGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097); days %= 146097;
  if (days > 36524) { gy += 100 * div(--days, 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * div(days, 1461); days %= 1461;
  if (days > 365) { gy += div(days - 1, 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const ml = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > ml[gm]; gm++) gd -= ml[gm];
  return [gy, gm, gd];
}

export const latinDigits = s => String(s ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const pad = n => String(n).padStart(2, "0");

// Any date a person or an accounting export may give → "YYYY-MM-DD" (Gregorian), or "" if unreadable.
// Accepts 1405/09/03, 1405-9-3, 05/09/03 (two-digit Jalali year), 2026-11-24, and Excel serial numbers.
export function parseDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 20000 && v < 80000) { // Excel serial (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const s = latinDigits(v).trim();
  const m = s.match(/^(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return "";
  let y = +m[1]; const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  if (y < 100) y += 1400;
  if (y < 1700) { const [gy, gm, gd] = toGregorian(y, mo, d); return `${gy}-${pad(gm)}-${pad(gd)}`; }
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function jalaliText(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const [jy, jm, jd] = toJalali(y, m, d);
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}
