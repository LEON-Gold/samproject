// Proforma maths, shared by the server (the authority) and the admin panel (live preview). Owner, 2026-11-24:
// - every product and every customer has its own offer; the sales manager picks the final offer per item:
//   "N به ۱" = one free piece for every N bought (۱ به ۱ … ۹ به ۱); 0 = no offer.
// - each item prints twice: the ordered quantity with its price, then the same product as the offer, free.
// - total of the goods + tax (10% by default), then the customer's margin is taken off that sum.
export const OFFERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const fa = n => String(n).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
export const offerLabel = n => n ? `${fa(n)} به ۱` : "بدون آفر";
export const freeQty = (qty, n) => n ? Math.floor(qty / n) : 0;
const pct = v => Math.max(0, Math.min(100, Math.round((+v || 0) * 100) / 100));

// product offer (0–9) + customer setting ("product" = follow the product, "none", or "1"…"9" for all items)
export function suggestOffer(productOffer, customerOffer) {
  if (customerOffer === "none") return 0;
  if (/^[1-9]$/.test(String(customerOffer))) return +customerOffer;
  return Math.max(0, Math.min(9, Math.floor(+productOffer || 0)));
}

export function buildProforma(items, { offers = {}, taxPct = 10, marginPct = 0 } = {}) {
  const lines = items.map(i => {
    const n = Math.max(0, Math.min(9, Math.floor(+offers[i.id] || 0)));
    return { id: i.id, code: i.code || "", name: i.name, qty: i.qty, price: i.price, sum: i.qty * i.price, offer: n, free: freeQty(i.qty, n) };
  });
  const subtotal = lines.reduce((a, l) => a + l.sum, 0);
  const t = pct(taxPct), m = pct(marginPct);
  const tax = Math.round(subtotal * t / 100), gross = subtotal + tax;
  const margin = Math.round(gross * m / 100);
  return { lines, subtotal, taxPct: t, tax, gross, marginPct: m, margin, total: gross - margin, freeTotal: lines.reduce((a, l) => a + l.free, 0) };
}
