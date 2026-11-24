// SAM customer app: products by category, cart → order or proforma, orders, festivals, invoices and balance.
import { $, $$, esc, api, token, fa, money, faDate, faDigits, latin, toast, STATUS, printDoc, countUpOnEnter } from "/common.js?v=4";

const S = { user: null, settings: {}, cats: [], products: [], festivals: [], orders: null, account: null, tab: "products", cat: "all", q: "", cart: {}, ordersSeg: "order" };
const app = $("#app");
const cartKey = () => "sam.cart." + (S.user?.id || 0);
const saveCart = () => { try { localStorage.setItem(cartKey(), JSON.stringify(S.cart)); } catch {} };
const loadCart = () => { try { S.cart = JSON.parse(localStorage.getItem(cartKey()) || "{}"); } catch { S.cart = {}; } };
const cur = () => S.settings.currency || "تومان";
const pById = id => S.products.find(p => p.id === +id);
const cartLines = () => Object.entries(S.cart).map(([id, q]) => ({ p: pById(id), q })).filter(l => l.p && l.q > 0);
const cartCount = () => cartLines().length;
const cartTotal = () => cartLines().reduce((a, l) => a + (l.p.price || 0) * l.q, 0);
const thumb = p => p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" decoding="async">` : `<span class="mono">SAM</span>`;

const ICON = {
  products: '<path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  festivals: '<path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6"/>',
  orders: '<path d="M8 3h8l3 3v15H5V3z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
};
const TABS = [["products", "محصولات"], ["festivals", "جشنواره"], ["cart", "سبد"], ["orders", "سفارش‌ها"], ["account", "حساب من"]];

// ---------- login ----------
function loginView(msg = "") {
  app.innerHTML = `<div class="login"><form class="card" id="lf" novalidate>
    <span class="brand">SAM</span><p>سفارش و پیش‌فاکتور برای فروشگاه‌ها و نمایندگی‌ها</p>
    <label class="field"><span>نام کاربری</span><input name="u" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" dir="ltr" required></label>
    <label class="field"><span>رمز عبور</span><input name="p" type="password" autocomplete="current-password" dir="ltr" required></label>
    <div class="err" role="alert">${esc(msg)}</div>
    <button class="btn primary" type="submit">ورود</button>
    <p style="margin:16px 0 0">نام کاربری و رمز را از کارشناس فروش سام بگیرید.</p>
  </form></div>`;
  $("#lf").onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = $("button", f);
    b.disabled = true;
    try { const r = await api("/api/login", { u: latin(f.u.value), p: latin(f.p.value) }); token.set(r.token); boot(); }
    catch (err) { $(".err", f).textContent = err.message; b.disabled = false; }
  };
}

// ---------- shell ----------
function shell() {
  app.innerHTML = `<header class="top"><span class="brand">${esc(S.settings.brand || "SAM")}</span><span class="who">${esc(S.user.name)}</span></header>
    <main id="main"></main>
    <nav class="tabs" aria-label="بخش‌ها">${TABS.map(([k, t]) => `<button type="button" data-tab="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${t}${k === "cart" ? '<span class="badge" id="cb" hidden></span>' : ""}</button>`).join("")}</nav>`;
  $$(".tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
}
function go(tab) {
  S.tab = tab;
  history.replaceState(null, "", "#" + tab);
  $$(".tabs button").forEach(b => b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  ({ products: viewProducts, festivals: viewFestivals, cart: viewCart, orders: viewOrders, account: viewAccount })[tab]();
  window.scrollTo(0, 0);
  replay($("#main"), "enter");
  countUpOnEnter($("#main"));
}
// restart a CSS animation class (one reflow, only on navigation / add)
function replay(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
let lastCount = 0;
function badge() { const b = $("#cb"); if (!b) return; const n = cartCount(); b.hidden = !n; b.textContent = fa(n); if (n > lastCount) replay(b, "bump"); lastCount = n; }

// ---------- products ----------
function stepper(p) {
  const q = S.cart[p.id] || 0;
  if (p.price == null) return `<button class="btn sm add" type="button" disabled>قیمت اعلام نشده</button>`;
  if (!q) return `<button class="btn primary add" type="button" data-add="${p.id}">افزودن به سبد</button>`;
  return `<div class="step" data-p="${p.id}"><button type="button" data-inc="${p.id}" aria-label="یکی بیشتر">+</button><input type="text" inputmode="numeric" value="${fa(q)}" aria-label="تعداد ${esc(p.name)}" data-qty="${p.id}"><button type="button" data-dec="${p.id}" aria-label="یکی کمتر">−</button></div>`;
}
function setQty(id, q) {
  q = Math.max(0, Math.min(100000, Math.floor(q) || 0));
  if (q) S.cart[id] = q; else delete S.cart[id];
  saveCart(); badge();
}
function bindSteppers(root, after) {
  root.onclick = e => {
    const t = e.target.closest("[data-add],[data-inc],[data-dec],[data-zoom]"); if (!t) return;
    if (t.dataset.zoom) return zoom(pById(t.dataset.zoom));
    const id = t.dataset.add || t.dataset.inc || t.dataset.dec;
    setQty(id, (S.cart[id] || 0) + (t.dataset.dec ? -1 : 1));
    after(id);
  };
  root.onchange = e => { const t = e.target.closest("[data-qty]"); if (t) { setQty(t.dataset.qty, +latin(t.value)); after(t.dataset.qty); } };
}
function viewProducts() {
  const running = S.festivals.filter(f => f.running);
  const m = $("#main");
  m.innerHTML = `
    ${running.map(f => `<button class="fest-strip" type="button" data-fest="${f.id}">${f.poster ? `<img src="${esc(f.poster)}" alt="">` : ""}<span><b>${esc(f.title)}</b><small>${festLine(f)}</small></span></button>`).join("")}
    <input class="search" type="search" placeholder="جستجوی نام یا کد محصول" aria-label="جستجو" value="${esc(S.q)}">
    <div class="chips" role="group" aria-label="دسته‌ها">${[["all", "همه"], ...S.cats.filter(c => S.products.some(p => p.cat === c.id)).map(c => [c.id, c.name]), ...(S.products.some(p => !p.cat || !S.cats.some(c => c.id === p.cat)) ? [["none", "سایر"]] : [])]
      .map(([k, n]) => `<button class="chip" type="button" data-cat="${k}" aria-pressed="${String(S.cat) === String(k)}">${esc(n)}</button>`).join("")}</div>
    <div id="plist"></div>`;
  $(".search", m).oninput = e => { S.q = e.target.value; list(false); };
  $$("[data-cat]", m).forEach(b => b.onclick = () => { S.cat = b.dataset.cat; $$("[data-cat]", m).forEach(x => x.setAttribute("aria-pressed", x === b)); list(true); });
  $$("[data-fest]", m).forEach(b => b.onclick = () => go("festivals"));
  const list = (animate = true) => {
    const q = latin(S.q).trim().toLowerCase();
    const ok = p => (S.cat === "all" || (S.cat === "none" ? !S.cats.some(c => c.id === p.cat) : p.cat === +S.cat)) && (!q || p.name.toLowerCase().includes(q) || latin(p.code).toLowerCase().includes(q));
    const items = S.products.filter(ok);
    const groups = S.cat === "all" && !q ? [...S.cats.map(c => [c.name, items.filter(p => p.cat === c.id)]), ["سایر", items.filter(p => !S.cats.some(c => c.id === p.cat))]].filter(g => g[1].length) : [[null, items]];
    $("#plist").innerHTML = items.length ? groups.map(([t, ps]) => `${t ? `<h3 class="sec-title">${esc(t)}</h3>` : ""}<div class="grid${animate ? " stagger" : ""}">${ps.map((p, i) => card(p).replace('class="card p"', `class="card p" style="--i:${i}"`)).join("")}</div>`).join("") : `<p class="empty">محصولی پیدا نشد.</p>`;
  };
  const card = p => `<article class="card p" data-card="${p.id}"><div class="thumb" data-zoom="${p.id}" role="button" aria-label="بزرگ‌نمایی ${esc(p.name)}">${thumb(p)}</div>
    <h3>${esc(p.name)}</h3><div class="meta">${p.code ? "کد " + esc(faDigits(p.code)) : ""}${p.pack > 1 ? ` · کارتن ${fa(p.pack)} ${esc(p.unit)}` : ""}</div>
    <div class="price num">${p.price != null ? `${fa(p.price)} <small>${esc(cur())}</small>` : `<small>—</small>`}</div><div data-st="${p.id}">${stepper(p)}</div></article>`;
  list();
  bindSteppers($("#plist"), id => { const el = $(`[data-st="${id}"]`); if (el) el.innerHTML = stepper(pById(id)); });
}
function zoom(p) {
  const d = document.createElement("dialog");
  d.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>${esc(p.name)}</h3><button class="btn sm ghost" type="button" data-x>بستن</button></div>
    <div class="zoom thumb">${thumb(p)}</div>${p.descr ? `<p>${esc(p.descr)}</p>` : ""}<p class="muted">${p.code ? "کد " + esc(faDigits(p.code)) : ""}${p.pack > 1 ? ` · کارتن ${fa(p.pack)} ${esc(p.unit)}` : ""}</p></div>`;
  document.body.append(d); d.showModal();
  d.onclick = e => { if (e.target === d || e.target.closest("[data-x]")) d.close(); };
  d.onclose = () => d.remove();
}

// ---------- cart ----------
function viewCart() {
  const m = $("#main"), lines = cartLines();
  if (!lines.length) { m.innerHTML = `<div class="h"><h2>سبد خرید</h2></div><p class="empty">سبد خالی است.<br><button class="btn" type="button" style="margin-top:14px" id="gp">دیدن محصولات</button></p>`; $("#gp").onclick = () => go("products"); return; }
  m.innerHTML = `<div class="h"><h2>سبد خرید</h2><button class="btn sm ghost danger" type="button" id="clr">خالی کردن</button></div>
    <div id="lines">${lines.map(({ p, q }) => `<div class="line"><div class="thumb">${thumb(p)}</div><div><div class="name">${esc(p.name)}</div><div class="muted" style="font-size:12.5px">${fa(p.price)} × ${fa(q)}</div>
      <div class="r"><div class="step" data-p="${p.id}"><button type="button" data-inc="${p.id}" aria-label="یکی بیشتر">+</button><input type="text" inputmode="numeric" value="${fa(q)}" data-qty="${p.id}" aria-label="تعداد"><button type="button" data-dec="${p.id}" aria-label="یکی کمتر">−</button></div>
      <b class="num">${fa(p.price * q)}</b></div></div></div>`).join("")}</div>
    <div class="card sum"><div class="tot"><span>جمع کل</span><span class="num">${money(cartTotal(), cur())}</span></div>
      <textarea id="note" placeholder="توضیح برای سفارش (اختیاری)" maxlength="500" rows="2" style="min-height:60px"></textarea>
      <div class="acts"><button class="btn" type="button" id="pf">پیش‌فاکتور</button><button class="btn primary" type="button" id="ok">ثبت سفارش</button></div></div>`;
  bindSteppers($("#lines"), () => { const n = $("#note").value; viewCart(); if ($("#note")) $("#note").value = n; });
  $("#clr").onclick = () => { if (confirm("سبد خالی شود؟")) { S.cart = {}; saveCart(); badge(); viewCart(); } };
  const send = kind => async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const o = await api("/api/orders", { kind, items: lines.map(l => ({ id: l.p.id, qty: l.q })), note: $("#note").value });
      S.cart = {}; saveCart(); badge(); S.orders = null;
      toast(kind === "order" ? `سفارش ${fa(o.id)} ثبت شد` : `پیش‌فاکتور ${fa(o.id)} آماده شد`);
      S.ordersSeg = kind === "order" ? "order" : "proforma"; go("orders"); openOrder(o);
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
  $("#pf").onclick = send("proforma"); $("#ok").onclick = send("order");
}

// ---------- orders ----------
const statusPill = o => `<span class="pill ${o.status === "cancelled" ? "bad" : o.status === "done" || o.status === "sent" ? "ok" : o.status === "open" ? "acc" : "warn"}">${STATUS[o.status]}</span>`;
async function viewOrders() {
  const m = $("#main");
  m.innerHTML = `<div class="h"><h2>سفارش‌ها</h2></div><div class="seg" role="group"><button type="button" data-s="order">سفارش‌ها</button><button type="button" data-s="proforma">پیش‌فاکتورها</button></div><div id="ol"><div class="loading" role="status" aria-label="در حال دریافت">در حال دریافت…</div></div>`;
  $$("[data-s]", m).forEach(b => { b.setAttribute("aria-pressed", b.dataset.s === S.ordersSeg); b.onclick = () => { S.ordersSeg = b.dataset.s; viewOrders(); }; });
  try { S.orders = S.orders || await api("/api/orders"); } catch (e) { $("#ol").innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  const list = S.orders.filter(o => o.kind === S.ordersSeg);
  $("#ol").innerHTML = list.length ? list.map(o => `<button class="card o" type="button" data-o="${o.id}"><div class="r"><b>${o.kind === "proforma" ? "پیش‌فاکتور" : "سفارش"} ${fa(o.id)}</b>${statusPill(o)}</div>
    <div class="r"><span>${faDate(o.created)} · ${fa(o.items.length)} قلم</span><b class="num" style="color:var(--ink)">${money(o.total, cur())}</b></div></button>`).join("")
    : `<p class="empty">${S.ordersSeg === "order" ? "هنوز سفارشی ثبت نکرده‌اید." : "پیش‌فاکتوری ندارید."}</p>`;
  $$("[data-o]").forEach(b => b.onclick = () => openOrder(S.orders.find(o => o.id === +b.dataset.o)));
}
function openOrder(o) {
  const d = document.createElement("dialog");
  d.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>${o.kind === "proforma" ? "پیش‌فاکتور" : "سفارش"} ${fa(o.id)}</h3>${statusPill(o)}</div>
    <div class="muted" style="font-size:13px">${faDate(o.created, true)}</div>
    <table class="items">${o.items.map(i => `<tr><td>${esc(i.name)}<div class="muted" style="font-size:12px">${fa(i.qty)} × ${fa(i.price)}</div></td><td class="num">${fa(i.sum)}</td></tr>`).join("")}
    <tr><td><b>جمع کل</b></td><td class="num"><b>${money(o.total, cur())}</b></td></tr></table>
    ${o.returns?.length ? `<p class="muted">مرجوعی: ${o.returns.map(r => `${esc(r.name)} × ${fa(r.qty)}`).join("، ")}</p>` : ""}
    ${o.note ? `<p class="muted">توضیح: ${esc(o.note)}</p>` : ""}
    ${o.kind === "proforma" ? `<p class="muted" style="font-size:13px">با «ثبت سفارش»، قیمت‌ها به‌روز می‌شوند.</p>` : ""}
    <div class="dlg-foot">
      ${o.kind === "proforma" && o.status === "open" ? `<button class="btn primary" type="button" data-a="submit">ثبت سفارش</button>` : ""}
      <button class="btn" type="button" data-a="print">چاپ / PDF</button>
      ${["new", "open"].includes(o.status) ? `<button class="btn ghost danger" type="button" data-a="cancel">لغو</button>` : ""}
      <button class="btn ghost" type="button" data-a="close">بستن</button></div></div>`;
  document.body.append(d); d.showModal();
  d.onclose = () => d.remove();
  d.onclick = async e => {
    if (e.target === d) return d.close();
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
    if (a === "close") return d.close();
    if (a === "print") return printDoc(o, S.settings, S.user);
    try {
      if (a === "submit") { const n = await api(`/api/orders/${o.id}/submit`, {}); toast(`سفارش ${fa(n.id)} ثبت شد`); S.ordersSeg = "order"; }
      if (a === "cancel") { if (!confirm("لغو شود؟")) return; await api(`/api/orders/${o.id}/cancel`, {}); toast("لغو شد"); }
      S.orders = null; d.close(); viewOrders();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- festivals ----------
function festLine(f) {
  const need = Math.max(0, f.min_amount - (f.bought || 0));
  if (!f.running) return `از ${faDate(f.start, true)}`;
  if (!f.min_amount) return `تا ${faDate(f.end, true)}`;
  return need ? `${money(need, cur())} تا ورود به جشنواره` : "شما وارد جشنواره شده‌اید";
}
function viewFestivals() {
  const m = $("#main");
  m.innerHTML = `<div class="h"><h2>جشنواره‌های فروش</h2></div>` + (S.festivals.length ? S.festivals.map(f => {
    const pct = f.min_amount ? Math.min(100, Math.round((f.bought || 0) / f.min_amount * 100)) : 100;
    return `<article class="card f">${f.poster ? `<img src="${esc(f.poster)}" alt="پوستر ${esc(f.title)}">` : `<div class="poster-none">SAM</div>`}
      <div class="b"><div class="row" style="justify-content:space-between"><h3>${esc(f.title)}</h3>${f.running ? `<span class="pill ok">در جریان</span>` : `<span class="pill">به‌زودی</span>`}</div>
      <dl class="kv"><dt>شروع</dt><dd>${faDate(f.start, true)}</dd><dt>پایان</dt><dd>${faDate(f.end, true)}</dd>${f.min_amount ? `<dt>حداقل خرید</dt><dd class="num">${money(f.min_amount, cur())}</dd>` : ""}</dl>
      ${f.running && f.min_amount ? `<div><div class="row" style="justify-content:space-between;font-size:13.5px;margin-bottom:6px"><span>خرید شما در این جشنواره: <b class="num">${money(f.bought || 0, cur())}</b></span><span class="muted">${fa(pct)}٪</span></div>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><div style="margin-top:6px;font-weight:600;font-size:14px">${festLine(f)}</div></div>` : ""}
      ${f.descr ? `<p>${esc(f.descr)}</p>` : ""}
      ${f.settle ? `<div><div class="muted" style="font-size:13px">نحوهٔ تسویه</div><p>${esc(f.settle)}</p></div>` : ""}</div></article>`;
  }).join("") : `<p class="empty">الان جشنواره‌ای در جریان نیست.</p>`);
}

// ---------- account ----------
async function viewAccount() {
  const m = $("#main");
  m.innerHTML = `<div class="h"><h2>حساب من</h2></div><div id="acc"><div class="loading" role="status" aria-label="در حال دریافت">در حال دریافت…</div></div>`;
  try { S.account = await api("/api/account"); } catch (e) { $("#acc").innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  const { balance: b, invoices } = S.account;
  $("#acc").innerHTML = `<div class="card bal"><span class="muted">مانده حساب</span>
      ${b ? `<span class="v num">${money(Math.abs(b.amount), cur())}</span><span class="pill ${b.amount > 0 ? "warn" : "ok"}" style="justify-self:start">${b.amount > 0 ? "بدهکار" : b.amount < 0 ? "بستانکار" : "تسویه"}</span><span class="muted" style="font-size:12.5px">به‌روز شده: ${faDate(b.as_of, true)}</span>` : `<span class="muted">هنوز از حسابداری ثبت نشده.</span>`}</div>
    <div class="card" style="padding:4px 14px 8px;margin-bottom:14px"><h3 style="font-size:16px;margin:12px 0 2px">فاکتورهای من</h3>
      ${invoices.length ? invoices.map((i, k) => `<div class="inv" data-inv="${k}" role="button" tabindex="0" style="cursor:pointer"><div><b>${i.kind === "return" ? "برگشت از فروش" : "فاکتور"} ${esc(faDigits(i.no))}</b><div class="muted" style="font-size:12.5px">${i.date ? faDate(i.date, true) : esc(faDigits(i.date_raw))}</div></div><span class="a num" style="${i.kind === "return" ? "color:var(--ok)" : ""}">${money(i.amount, cur())}</span></div>`).join("") : `<p class="muted">فاکتوری ثبت نشده.</p>`}</div>
    <div class="card" style="padding:14px"><div class="muted" style="font-size:13px">${esc(S.user.name)}${S.user.city ? " · " + esc(S.user.city) : ""}<br>نام کاربری: <span dir="ltr">${esc(S.user.username)}</span></div>
      <div class="row" style="margin-top:12px"><button class="btn" type="button" id="pw">تغییر رمز</button><button class="btn ghost danger" type="button" id="out">خروج</button></div></div>`;
  $$("[data-inv]").forEach(el => el.onclick = el.onkeydown = e => { if (e.type === "keydown" && e.key !== "Enter") return; openInvoice(invoices[+el.dataset.inv]); });
  $("#out").onclick = async () => { try { await api("/api/logout", {}); } catch {} token.set(""); location.hash = ""; location.reload(); };
  $("#pw").onclick = () => {
    const d = document.createElement("dialog");
    d.innerHTML = `<form method="dialog" id="pf"><div class="dlg-head"><h3>تغییر رمز</h3></div>
      <label class="field"><span>رمز فعلی</span><input name="old" type="password" autocomplete="current-password" dir="ltr" required></label>
      <label class="field"><span>رمز جدید (حداقل ۶ حرف)</span><input name="nw" type="password" autocomplete="new-password" dir="ltr" minlength="6" required></label>
      <div class="dlg-foot"><button class="btn primary" value="ok">ذخیره</button><button class="btn ghost" value="x" formnovalidate>انصراف</button></div></form>`;
    document.body.append(d); d.showModal(); d.onclose = () => d.remove();
    $("#pf", d).onsubmit = async e => {
      if (e.submitter?.value !== "ok") return; e.preventDefault();
      try { await api("/api/password", { old: latin(e.target.old.value), new: latin(e.target.nw.value) }); toast("رمز عوض شد"); d.close(); } catch (err) { toast(err.message, true); }
    };
  };
}

// an invoice from accounting: its lines, and print / PDF (owner, 2026-11-24)
function openInvoice(i) {
  const title = i.kind === "return" ? "برگشت از فروش" : "فاکتور فروش";
  const doc = { title, no: i.no, date: i.date, date_raw: i.date_raw, items: i.items.length ? i.items : [{ name: title, sum: i.amount }], total: i.amount };
  const d = document.createElement("dialog");
  d.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>${title} ${esc(faDigits(i.no))}</h3></div>
    <div class="muted" style="font-size:13px">${i.date ? faDate(i.date, true) : esc(faDigits(i.date_raw))}</div>
    <table class="items">${doc.items.map(x => `<tr><td>${esc(x.name)}${x.qty != null ? `<div class="muted" style="font-size:12px">${fa(x.qty)}${x.price != null ? " × " + fa(x.price) : ""}</div>` : ""}</td><td class="num">${fa(x.sum)}</td></tr>`).join("")}
    <tr><td><b>جمع کل</b></td><td class="num"><b>${money(i.amount, cur())}</b></td></tr></table>
    <div class="dlg-foot"><button class="btn primary" type="button" data-a="print">چاپ / PDF</button><button class="btn ghost" type="button" data-a="close">بستن</button></div></div>`;
  document.body.append(d); d.showModal();
  d.onclose = () => d.remove();
  d.onclick = e => { const a = e.target.closest("[data-a]")?.dataset.a; if (e.target === d || a === "close") d.close(); if (a === "print") printDoc(doc, S.settings, S.user); };
}

// ---------- boot ----------
async function boot() {
  if (!token.get()) return loginView();
  try {
    const me = await api("/api/me");
    if (me.user.role === "admin") { token.set(""); return loginView("این حساب مدیر است؛ برای پنل به ‎/admin‎ بروید."); }
    S.user = me.user; S.settings = me.settings; loadCart();
    const c = await api("/api/catalog");
    Object.assign(S, { cats: c.cats, products: c.products, festivals: c.festivals, settings: c.settings });
    for (const id of Object.keys(S.cart)) if (!pById(id) || pById(id).price == null) delete S.cart[id];
    shell(); badge();
    const want = location.hash.slice(1);
    go(TABS.some(t => t[0] === want) ? want : "products");
  } catch (e) { if (!token.get()) loginView(); else app.innerHTML = `<p class="empty">${esc(e.message)}<br><button class="btn" style="margin-top:12px" onclick="location.reload()">دوباره</button></p>`; }
}
boot();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
