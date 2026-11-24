// SAM admin panel: orders, agency report, products, categories, customers, festivals, file imports, settings.
import { $, $$, esc, api, token, fa, money, faDate, faDigits, latin, toast, STATUS, printDoc, shrinkImage, fileB64 } from "/common.js";

const app = $("#app");
const S = { settings: {}, cats: [], products: [], customers: [], orders: [], me: null };
const cur = () => S.settings.currency || "تومان";
const levels = () => S.settings.levels || [];
const NAV = [["home", "خلاصه"], ["orders", "سفارش‌ها"], ["report", "گزارش نمایندگی‌ها"], ["products", "محصولات"], ["cats", "دسته‌بندی"], ["customers", "مشتری‌ها"], ["festivals", "جشنواره‌ها"], ["import", "ورود فایل"], ["settings", "تنظیمات"]];
const page = (title, sub, actions = "") => `<div class="ph"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
const thumb = src => src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<span class="mono" style="font-size:11px">SAM</span>`;
const numIn = v => { const n = +latin(String(v ?? "")).replace(/[٬,\s]/g, ""); return isFinite(n) ? n : 0; };
const catName = id => S.cats.find(c => c.id === id)?.name || "بدون دسته";

function dialog(html, onSubmit) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form method="dialog" novalidate>${html}</form>`;
  document.body.append(d); d.showModal();
  d.onclose = () => d.remove();
  const f = $("form", d);
  f.onsubmit = async e => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const b = e.submitter; b.disabled = true;
    try { if ((await onSubmit(f, d)) !== false) d.close(); } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
  };
  return d;
}
const foot = (ok = "ذخیره", extra = "") => `<div class="dlg-foot"><button class="btn primary" value="ok">${ok}</button>${extra}<button class="btn ghost" value="x" formnovalidate>انصراف</button></div>`;
function pickImage(root, sel, onUrl) {
  const inp = $(sel, root);
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { const data = await shrinkImage(f, sel.includes("poster") ? 1800 : 1400); const { url } = await api("/api/admin/upload", { data }); onUrl(url); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------- login / shell ----------
function loginView(msg = "") {
  app.innerHTML = `<div style="min-height:100dvh;display:grid;place-items:center;padding:16px"><form class="card" id="lf" style="width:100%;max-width:360px;padding:26px 22px">
    <div style="font-weight:800;letter-spacing:.22em;font-size:26px;text-align:center">SAM</div><p class="muted" style="text-align:center;margin:2px 0 20px">پنل مدیریت</p>
    <label class="field"><span>نام کاربری</span><input name="u" type="text" autocomplete="username" autocapitalize="none" dir="ltr" required></label>
    <label class="field"><span>رمز عبور</span><input name="p" type="password" autocomplete="current-password" dir="ltr" required></label>
    <p style="color:var(--bad);min-height:22px;margin:0 0 8px;font-size:14px" role="alert">${esc(msg)}</p>
    <button class="btn primary" style="width:100%">ورود</button></form></div>`;
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    try { const r = await api("/api/login", { u: latin(e.target.u.value), p: latin(e.target.p.value) }); if (r.user.role !== "admin") { token.set(""); return loginView("این حساب مدیر نیست؛ مشتری‌ها از صفحهٔ اصلی وارد شوند."); } token.set(r.token); boot(); }
    catch (err) { loginView(err.message); }
  };
}
function shell() {
  app.innerHTML = `<div class="wrap"><aside class="side"><div class="brand">${esc(S.settings.brand || "SAM")}<small>پنل مدیریت</small></div>
    <nav class="nav">${NAV.map(([k, t]) => `<a href="#${k}" data-k="${k}">${t}${k === "orders" ? '<span class="pill acc" id="nn" hidden></span>' : ""}</a>`).join("")}</nav>
    <button class="btn sm ghost out" type="button" id="out">خروج</button></aside><main class="content" id="main"></main></div>`;
  $("#out").onclick = async () => { try { await api("/api/logout", {}); } catch {} token.set(""); location.hash = ""; location.reload(); };
}
async function route() {
  const k = location.hash.slice(1) || "home";
  $$(".nav a").forEach(a => a.dataset.k === k ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const m = $("#main"); m.innerHTML = `<p class="empty">در حال دریافت…</p>`;
  try { await (VIEWS[k] || VIEWS.home)(m); } catch (e) { m.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}
async function refreshBadge() { try { const o = await api("/api/admin/overview"); const b = $("#nn"); if (b) { b.hidden = !o.newOrders; b.textContent = fa(o.newOrders); } return o; } catch { return null; } }

const VIEWS = {};

// ---------- home ----------
VIEWS.home = async m => {
  const o = await refreshBadge() || {};
  const rep = await api("/api/admin/report");
  const late = rep.filter(r => r.active && r.every && r.sinceLast != null && r.sinceLast > r.every * 1.5).sort((a, b) => b.sinceLast - a.sinceLast).slice(0, 6);
  m.innerHTML = page("خلاصه", faDate(new Date().toISOString(), true)) + `<div class="stats">
      <a class="card stat" href="#orders"><b class="num">${fa(o.newOrders)}</b><span>سفارش جدید</span></a>
      <a class="card stat" href="#customers"><b class="num">${fa(o.customers)}</b><span>مشتری فعال</span></a>
      <a class="card stat" href="#products"><b class="num">${fa(o.products)}</b><span>محصول${o.noPrice ? ` · ${fa(o.noPrice)} بدون قیمت` : ""}</span></a>
      <a class="card stat" href="#festivals"><b class="num">${fa(o.festivals)}</b><span>جشنوارهٔ در جریان</span></a></div>
    <section class="card panel"><h2>نمایندگی‌هایی که دیر کرده‌اند</h2>${late.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>نام</th><th>آخرین خرید</th><th>معمولاً هر</th></tr></thead><tbody>${late.map(r => `<tr><td>${esc(r.name)}</td><td>${fa(r.sinceLast)} روز پیش</td><td>${fa(r.every)} روز</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">موردی نیست.</p>`}</section>`;
};

// ---------- orders ----------
const pill = s => `<span class="pill ${s === "cancelled" ? "bad" : s === "done" || s === "sent" ? "ok" : s === "open" ? "acc" : "warn"}">${STATUS[s]}</span>`;
VIEWS.orders = async m => {
  S.orders = await api("/api/admin/orders");
  let f = { q: "", kind: "order", st: "" };
  m.innerHTML = page("سفارش‌ها", "سفارش‌ها و پیش‌فاکتورهای مشتری‌ها") + `<div class="tools"><input type="search" placeholder="جستجوی مشتری یا شماره" id="q"><select id="kind"><option value="order">سفارش‌ها</option><option value="proforma">پیش‌فاکتورها</option></select>
    <select id="st"><option value="">همهٔ وضعیت‌ها</option>${["new", "confirmed", "sent", "done", "cancelled"].map(s => `<option value="${s}">${STATUS[s]}</option>`).join("")}</select></div><div class="card scroll-x" id="ol"></div>`;
  const draw = () => {
    const q = latin(f.q).trim();
    const list = S.orders.filter(o => o.kind === f.kind && (!f.st || o.status === f.st) && (!q || o.uname.includes(q) || String(o.id) === q));
    $("#ol").innerHTML = list.length ? `<table class="t"><thead><tr><th>شماره</th><th>مشتری</th><th>تاریخ</th><th>اقلام</th><th>مبلغ (${esc(cur())})</th><th>وضعیت</th></tr></thead><tbody>${list.map(o => `<tr class="click" data-o="${o.id}"><td>${fa(o.id)}</td><td>${esc(o.uname)}<div class="muted" style="font-size:12px">${esc(o.ucity || "")}</div></td><td>${faDate(o.created)}</td><td>${fa(o.items.length)}</td><td class="num">${fa(o.total)}</td><td>${pill(o.status)}${o.returns.length ? ' <span class="pill bad">مرجوعی</span>' : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">موردی نیست.</p>`;
    $$("[data-o]").forEach(r => r.onclick = () => openOrder(S.orders.find(o => o.id === +r.dataset.o), m));
  };
  $("#q").oninput = e => { f.q = e.target.value; draw(); };
  $("#kind").onchange = e => { f.kind = e.target.value; draw(); };
  $("#st").onchange = e => { f.st = e.target.value; draw(); };
  draw();
};
function openOrder(o, m) {
  const isOrder = o.kind === "order";
  const d = dialog(`<div class="dlg-head"><h3>${isOrder ? "سفارش" : "پیش‌فاکتور"} ${fa(o.id)}</h3>${pill(o.status)}</div>
    <p style="margin:0 0 8px"><b>${esc(o.uname)}</b> <span class="muted">${esc(o.ucity || "")} ${o.uphone ? "· " + esc(faDigits(o.uphone)) : ""}</span><br><span class="muted" style="font-size:13px">${faDate(o.created, true)}</span></p>
    <div class="scroll-x"><table class="t"><thead><tr><th>کالا</th><th>تعداد</th><th>فی</th><th>جمع</th></tr></thead><tbody>${o.items.map(i => `<tr><td>${esc(i.name)}<div class="muted" style="font-size:12px">${esc(faDigits(i.code))}</div></td><td>${fa(i.qty)}</td><td class="num">${fa(i.price)}</td><td class="num">${fa(i.sum)}</td></tr>`).join("")}
    <tr><td colspan="3"><b>جمع کل</b></td><td class="num"><b>${fa(o.total)}</b></td></tr></tbody></table></div>
    ${o.note ? `<p>توضیح مشتری: ${esc(o.note)}</p>` : ""}
    ${o.returns.length ? `<p><b>مرجوعی‌ها:</b><br>${o.returns.map(r => `${esc(r.name)} × ${fa(r.qty)} = ${money(r.amount, cur())} <span class="muted">(${faDate(r.date)}${r.note ? " · " + esc(r.note) : ""})</span>`).join("<br>")}</p>` : ""}
    ${isOrder ? `<label class="field"><span>وضعیت</span><select name="status">${["new", "confirmed", "sent", "done", "cancelled"].map(s => `<option value="${s}" ${s === o.status ? "selected" : ""}>${STATUS[s]}</option>`).join("")}</select></label>
    <details><summary style="cursor:pointer;font-weight:600;margin-bottom:8px">ثبت مرجوعی</summary><div class="grid2"><label class="field"><span>کالا</span><select name="rid"><option value="">—</option>${o.items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select></label>
      <label class="field"><span>تعداد</span><input name="rqty" type="text" inputmode="numeric"></label></div><label class="field"><span>علت (اختیاری)</span><input name="rnote" type="text"></label></details>` : `<p class="muted">پیش‌فاکتور است؛ وقتی مشتری «ثبت سفارش» بزند، در سفارش‌ها می‌آید.</p>`}`
    + foot(isOrder ? "ذخیره" : "بستن", `<button class="btn" type="button" data-print>چاپ / PDF</button>`), async f => {
    if (!isOrder) return;
    const body = { status: f.status.value };
    if (f.rid.value && numIn(f.rqty.value)) body.addReturn = { id: +f.rid.value, qty: numIn(f.rqty.value), note: f.rnote.value };
    await api(`/api/admin/orders/${o.id}`, body); toast("ذخیره شد"); refreshBadge(); VIEWS.orders(m);
  });
  $("[data-print]", d).onclick = () => printDoc(o, S.settings, { name: o.uname, city: o.ucity, phone: o.uphone });
}

// ---------- agency report ----------
VIEWS.report = async m => {
  const rep = await api("/api/admin/report");
  let sort = "sales";
  const SORTS = { sales: ["بیشترین فروش", (a, b) => b.sales - a.sales], returns: ["بیشترین مرجوعی", (a, b) => b.returns - a.returns], every: ["پرتکرارترین سفارش", (a, b) => (a.every ?? 1e9) - (b.every ?? 1e9)], late: ["بیشترین فاصله از آخرین خرید", (a, b) => (b.sinceLast ?? -1) - (a.sinceLast ?? -1)], balance: ["بیشترین بدهی", (a, b) => (b.balance ?? -1e15) - (a.balance ?? -1e15)] };
  m.innerHTML = page("گزارش نمایندگی‌ها", "فروش، مرجوعی و فاصلهٔ سفارش‌ها. اگر فاکتورهای حسابداری وارد شده باشد، از آن‌ها حساب می‌شود؛ وگرنه از سفارش‌های اپ.") +
    `<div class="tools"><select id="srt">${Object.entries(SORTS).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("")}</select></div><div class="card scroll-x" id="rt"></div>`;
  const draw = () => {
    const list = rep.slice().sort(SORTS[sort][1]);
    $("#rt").innerHTML = list.length ? `<table class="t"><thead><tr><th>نمایندگی</th><th>فروش (${esc(cur())})</th><th>تعداد</th><th>مرجوعی</th><th>هر چند روز</th><th>آخرین خرید</th><th>مانده</th></tr></thead><tbody>${list.map(r => `<tr><td>${esc(r.name)}<div class="muted" style="font-size:12px">${esc(r.city || "")}${r.code ? " · کد " + esc(faDigits(r.code)) : ""}</div></td>
      <td class="num">${fa(r.sales)}<div class="muted" style="font-size:11px">${r.source === "invoices" ? "فاکتور" : "سفارش اپ"}</div></td><td>${fa(r.count)}</td>
      <td class="num">${r.returns ? `<span style="color:var(--bad)">${fa(r.returns)}</span><div class="muted" style="font-size:11px">${r.sales ? fa(Math.round(r.returns / r.sales * 100)) + "٪ فروش" : ""}</div>` : "—"}</td>
      <td>${r.every ? fa(r.every) + " روز" : "—"}</td><td>${r.last ? `${faDate(r.last)}<div class="muted" style="font-size:11px">${fa(r.sinceLast)} روز پیش</div>` : "—"}</td>
      <td class="num">${r.balance != null ? fa(r.balance) : "—"}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">هنوز مشتری‌ای ثبت نشده.</p>`;
  };
  $("#srt").onchange = e => { sort = e.target.value; draw(); };
  draw();
};

// ---------- products ----------
VIEWS.products = async m => {
  [S.products, S.cats] = await Promise.all([api("/api/admin/products"), api("/api/admin/cats")]);
  let q = "", cat = "", showOff = false;
  m.innerHTML = page("محصولات", "عکس، دسته، کد و قیمت هر سطح", `<a class="btn" href="#import">ورود لیست قیمت</a><button class="btn primary" type="button" id="add">محصول جدید</button>`) +
    `<div class="tools"><input type="search" id="q" placeholder="جستجوی نام یا کد"><select id="cf"><option value="">همهٔ دسته‌ها</option>${S.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}<option value="none">بدون دسته</option></select>
    <label class="check"><input type="checkbox" id="off"> غیرفعال‌ها هم</label></div><div class="card scroll-x" id="pl"></div>`;
  const draw = () => {
    const qq = latin(q).trim().toLowerCase();
    const list = S.products.filter(p => (showOff || p.active) && (!cat || (cat === "none" ? !S.cats.some(c => c.id === p.cat) : p.cat === +cat)) && (!qq || p.name.toLowerCase().includes(qq) || latin(p.code).toLowerCase().includes(qq)));
    $("#pl").innerHTML = list.length ? `<table class="t"><thead><tr><th></th><th>نام</th><th>کد</th><th>دسته</th>${levels().map(l => `<th>${esc(l.name)}</th>`).join("")}<th></th></tr></thead><tbody>${list.map(p => `<tr class="click" data-p="${p.id}" style="${p.active ? "" : "opacity:.5"}"><td><div class="thumb">${thumb(p.img)}</div></td><td>${esc(p.name)}</td><td>${esc(faDigits(p.code))}</td><td>${esc(catName(p.cat))}</td>${levels().map(l => `<td class="num">${p.prices[l.k] != null ? fa(p.prices[l.k]) : '<span class="pill warn">ندارد</span>'}</td>`).join("")}<td>${p.active ? "" : '<span class="pill">غیرفعال</span>'}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">محصولی نیست.</p>`;
    $$("[data-p]").forEach(r => r.onclick = () => editProduct(S.products.find(p => p.id === +r.dataset.p), m));
  };
  $("#q").oninput = e => { q = e.target.value; draw(); };
  $("#cf").onchange = e => { cat = e.target.value; draw(); };
  $("#off").onchange = e => { showOff = e.target.checked; draw(); };
  $("#add").onclick = () => editProduct({ name: "", code: "", cat: S.cats[0]?.id, prices: {}, pack: 1, unit: "عدد", active: true }, m);
  draw();
};
function editProduct(p, m) {
  let img = p.img || "";
  const d = dialog(`<div class="dlg-head"><h3>${p.id ? "ویرایش محصول" : "محصول جدید"}</h3></div>
    <div class="img-pick"><div class="thumb" id="pi">${thumb(img)}</div><div><label class="btn sm">انتخاب عکس<input type="file" accept="image/*" id="pimg" hidden></label> <button class="btn sm ghost" type="button" id="noimg">حذف عکس</button></div></div>
    <label class="field"><span>نام محصول</span><input name="name" type="text" value="${esc(p.name)}" required></label>
    <div class="grid2"><label class="field"><span>کد کالا</span><input name="code" type="text" value="${esc(p.code)}" dir="ltr"></label>
    <label class="field"><span>دسته</span><select name="cat"><option value="">بدون دسته</option>${S.cats.map(c => `<option value="${c.id}" ${c.id === p.cat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <label class="field"><span>تعداد در کارتن</span><input name="pack" type="text" inputmode="numeric" value="${esc(p.pack)}"></label>
    <label class="field"><span>واحد</span><input name="unit" type="text" value="${esc(p.unit)}"></label></div>
    <div class="field"><span>قیمت هر سطح (${esc(cur())})</span><div class="prices">${levels().map(l => `<label class="field" style="margin:0"><span>${esc(l.name)}</span><input type="text" inputmode="numeric" data-lv="${esc(l.k)}" value="${p.prices[l.k] != null ? p.prices[l.k] : ""}"></label>`).join("")}</div></div>
    <label class="field"><span>توضیح (اختیاری)</span><textarea name="descr">${esc(p.descr || "")}</textarea></label>
    <label class="check"><input type="checkbox" name="active" ${p.active ? "checked" : ""}> در اپ نمایش داده شود</label>` + foot(), async f => {
    const prices = {}; $$("[data-lv]", f).forEach(i => { if (i.value.trim()) prices[i.dataset.lv] = numIn(i.value); });
    await api("/api/admin/products", { id: p.id, name: f.name.value, code: latin(f.code.value), cat: f.cat.value || null, pack: numIn(f.pack.value) || 1, unit: f.unit.value, prices, descr: f.descr.value, img, active: f.active.checked });
    toast("ذخیره شد"); VIEWS.products(m);
  });
  pickImage(d, "#pimg", url => { img = url; $("#pi", d).innerHTML = thumb(url); });
  $("#noimg", d).onclick = () => { img = ""; $("#pi", d).innerHTML = thumb(""); };
}

// ---------- categories ----------
VIEWS.cats = async m => {
  S.cats = await api("/api/admin/cats");
  let list = S.cats.map(c => ({ ...c }));
  m.innerHTML = page("دسته‌بندی", "دسته‌ها به همین ترتیب در اپ نشان داده می‌شوند.") + `<section class="card panel" style="max-width:560px"><ul class="cats" id="cl"></ul>
    <div class="row"><button class="btn" type="button" id="ad">+ دستهٔ جدید</button><button class="btn primary" type="button" id="sv">ذخیره</button></div></section>`;
  const draw = () => {
    $("#cl").innerHTML = list.map((c, i) => `<li><input type="text" value="${esc(c.name)}" data-i="${i}" aria-label="نام دسته" placeholder="نام دسته"><span class="muted" style="font-size:12px;min-width:56px">${c.n != null ? fa(c.n) + " محصول" : "جدید"}</span>
      <button class="btn sm ghost" type="button" data-up="${i}" aria-label="بالاتر" ${i ? "" : "disabled"}>▲</button><button class="btn sm ghost" type="button" data-dn="${i}" aria-label="پایین‌تر" ${i < list.length - 1 ? "" : "disabled"}>▼</button><button class="btn sm ghost danger" type="button" data-rm="${i}">حذف</button></li>`).join("") || `<li class="muted">دسته‌ای نیست.</li>`;
  };
  const grab = () => $$("#cl input").forEach(i => list[+i.dataset.i].name = i.value);
  $("#cl").onclick = e => {
    const t = e.target.closest("button"); if (!t) return; grab();
    const i = +(t.dataset.up ?? t.dataset.dn ?? t.dataset.rm);
    if (t.dataset.up) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (t.dataset.dn) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    if (t.dataset.rm) { if (list[i].n && !confirm(`«${list[i].name}» ${fa(list[i].n)} محصول دارد؛ آن‌ها «بدون دسته» می‌شوند. حذف شود؟`)) return; list.splice(i, 1); }
    draw();
  };
  $("#ad").onclick = () => { grab(); list.push({ name: "" }); draw(); $$("#cl input").pop().focus(); };
  $("#sv").onclick = async () => { grab(); try { await api("/api/admin/cats", { cats: list }); toast("ذخیره شد"); VIEWS.cats(m); } catch (e) { toast(e.message, true); } };
  draw();
};

// ---------- customers ----------
VIEWS.customers = async m => {
  S.customers = await api("/api/admin/customers");
  let q = "";
  m.innerHTML = page("مشتری‌ها", "هر مشتری با نام کاربری و رمز خودش وارد اپ می‌شود و قیمت سطح خودش را می‌بیند.", `<button class="btn primary" type="button" id="add">مشتری جدید</button>`) +
    `<div class="tools"><input type="search" id="q" placeholder="جستجوی نام، شهر یا کد"></div><div class="card scroll-x" id="cl"></div>`;
  const draw = () => {
    const qq = latin(q).trim();
    const list = S.customers.filter(c => !qq || c.name.includes(qq) || c.city.includes(qq) || latin(c.code).includes(qq) || c.username.includes(qq.toLowerCase()));
    $("#cl").innerHTML = list.length ? `<table class="t"><thead><tr><th>نام</th><th>شهر</th><th>کد حسابداری</th><th>سطح قیمت</th><th>نام کاربری</th><th></th></tr></thead><tbody>${list.map(c => `<tr class="click" data-c="${c.id}" style="${c.active ? "" : "opacity:.5"}"><td>${esc(c.name)}<div class="muted" style="font-size:12px">${esc(c.contact)} ${c.phone ? esc(faDigits(c.phone)) : ""}</div></td><td>${esc(c.city)}</td><td>${esc(faDigits(c.code)) || '<span class="pill warn">ندارد</span>'}</td><td>${esc(levels().find(l => l.k === c.level)?.name || c.level)}</td><td dir="ltr" style="text-align:end">${esc(c.username)}</td><td>${c.active ? "" : '<span class="pill">غیرفعال</span>'}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">مشتری‌ای نیست.</p>`;
    $$("[data-c]").forEach(r => r.onclick = () => editCustomer(S.customers.find(c => c.id === +r.dataset.c), m));
  };
  $("#q").oninput = e => { q = e.target.value; draw(); };
  $("#add").onclick = () => editCustomer({ name: "", username: "", contact: "", phone: "", city: "", code: "", level: levels()[0]?.k, active: true }, m);
  draw();
};
function editCustomer(c, m) {
  dialog(`<div class="dlg-head"><h3>${c.id ? "ویرایش مشتری" : "مشتری جدید"}</h3></div>
    <label class="field"><span>نام فروشگاه / نمایندگی</span><input name="name" type="text" value="${esc(c.name)}" required></label>
    <div class="grid2"><label class="field"><span>نام مسئول</span><input name="contact" type="text" value="${esc(c.contact)}"></label>
    <label class="field"><span>تلفن</span><input name="phone" type="tel" value="${esc(c.phone)}" dir="ltr"></label>
    <label class="field"><span>شهر</span><input name="city" type="text" value="${esc(c.city)}"></label>
    <label class="field"><span>کد مشتری در حسابداری</span><input name="code" type="text" value="${esc(c.code)}" dir="ltr"></label></div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 12px">کد حسابداری برای وصل کردن فاکتورها و مانده‌حساب اکسل به همین مشتری است.</p>
    <label class="field"><span>سطح قیمت</span><select name="level">${levels().map(l => `<option value="${esc(l.k)}" ${l.k === c.level ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
    <div class="grid2"><label class="field"><span>نام کاربری (انگلیسی)</span><input name="username" type="text" value="${esc(c.username)}" dir="ltr" autocapitalize="none" required></label>
    <label class="field"><span>${c.id ? "رمز جدید (خالی = بدون تغییر)" : "رمز (حداقل ۶ حرف)"}</span><input name="password" type="text" dir="ltr" autocomplete="off"></label></div>
    <label class="check"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> فعال (می‌تواند وارد شود)</label>` + foot(), async f => {
    await api("/api/admin/customers", { id: c.id, name: f.name.value, contact: f.contact.value, phone: latin(f.phone.value), city: f.city.value, code: latin(f.code.value), level: f.level.value, username: latin(f.username.value), password: latin(f.password.value), active: f.active.checked });
    toast("ذخیره شد"); VIEWS.customers(m);
  });
}

// ---------- festivals ----------
VIEWS.festivals = async m => {
  const list = await api("/api/admin/festivals");
  m.innerHTML = page("جشنواره‌های فروش", "پوستر، توضیحات، حداقل خرید، تاریخ‌ها و نحوهٔ تسویه", `<button class="btn primary" type="button" id="add">جشنوارهٔ جدید</button>`) +
    (list.length ? list.map(f => `<article class="card panel" style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap"><div class="thumb" style="width:150px;aspect-ratio:16/9;flex:none">${thumb(f.poster)}</div>
      <div class="grow"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(f.title)}</h2>${!f.active ? '<span class="pill">غیرفعال</span>' : f.running ? '<span class="pill ok">در جریان</span>' : f.end < new Date().toISOString().slice(0, 10) ? '<span class="pill">تمام شده</span>' : '<span class="pill acc">به‌زودی</span>'}</div>
      <p class="muted" style="margin:4px 0">${faDate(f.start, true)} تا ${faDate(f.end, true)}${f.min_amount ? ` · حداقل خرید ${money(f.min_amount, cur())}` : ""}</p>
      <div class="row"><button class="btn sm" type="button" data-e="${f.id}">ویرایش</button><button class="btn sm" type="button" data-pr="${f.id}">وضعیت مشتری‌ها</button><button class="btn sm ghost danger" type="button" data-rm="${f.id}">حذف</button></div></div></article>`).join("") : `<p class="empty">جشنواره‌ای ثبت نشده.</p>`);
  $("#add").onclick = () => editFestival({ title: "", poster: "", descr: "", min_amount: 0, start: "", end: "", settle: "", active: true }, m);
  $$("[data-e]").forEach(b => b.onclick = () => editFestival(list.find(f => f.id === +b.dataset.e), m));
  $$("[data-rm]").forEach(b => b.onclick = async () => { if (!confirm("این جشنواره حذف شود؟")) return; await api(`/api/admin/festivals/${b.dataset.rm}/delete`, {}); toast("حذف شد"); VIEWS.festivals(m); });
  $$("[data-pr]").forEach(b => b.onclick = async () => {
    const f = list.find(x => x.id === +b.dataset.pr), rows = await api(`/api/admin/festivals/${f.id}/progress`);
    dialog(`<div class="dlg-head"><h3>${esc(f.title)}</h3></div><p class="muted" style="margin-top:0">خرید هر مشتری بین ${faDate(f.start, true)} و ${faDate(f.end, true)}</p>
      <div class="scroll-x"><table class="t"><thead><tr><th>مشتری</th><th>خرید (${esc(cur())})</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${fa(r.bought)}</td><td>${f.min_amount && r.bought >= f.min_amount ? '<span class="pill ok">وارد شده</span>' : f.min_amount ? `<span class="muted" style="font-size:12px">${fa(f.min_amount - r.bought)} مانده</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`
      + `<div class="dlg-foot"><button class="btn ghost" value="x" formnovalidate>بستن</button></div>`, () => {});
  });
};
function editFestival(f, m) {
  let poster = f.poster || "";
  const jd = iso => iso ? latin(faDate(iso)).replace(/[⁦⁩]/g, "") : "";
  const d = dialog(`<div class="dlg-head"><h3>${f.id ? "ویرایش جشنواره" : "جشنوارهٔ جدید"}</h3></div>
    <div class="img-pick poster-pick"><div class="thumb" id="pp">${thumb(poster)}</div><div><label class="btn sm">پوستر تبلیغاتی<input type="file" accept="image/*" id="poster" hidden></label><p class="muted" style="font-size:12px;margin:6px 0 0">بهتر است افقی (۱۶:۹) باشد.</p></div></div>
    <label class="field"><span>عنوان</span><input name="title" type="text" value="${esc(f.title)}" required></label>
    <label class="field"><span>توضیحات</span><textarea name="descr" rows="4">${esc(f.descr)}</textarea></label>
    <label class="field"><span>حداقل خرید برای ورود (${esc(cur())})</span><input name="min" type="text" inputmode="numeric" value="${f.min_amount || ""}" placeholder="۰ یعنی بدون حداقل"></label>
    <div class="grid2"><label class="field"><span>تاریخ شروع</span><input name="start" type="text" inputmode="numeric" placeholder="۱۴۰۵/۰۹/۱۰" value="${esc(jd(f.start))}" dir="ltr" required></label>
    <label class="field"><span>تاریخ پایان</span><input name="end" type="text" inputmode="numeric" placeholder="۱۴۰۵/۰۹/۳۰" value="${esc(jd(f.end))}" dir="ltr" required></label></div>
    <label class="field"><span>نحوهٔ تسویه</span><textarea name="settle" rows="3">${esc(f.settle)}</textarea></label>
    <label class="check"><input type="checkbox" name="active" ${f.active ? "checked" : ""}> در اپ نمایش داده شود</label>` + foot(), async fm => {
    await api("/api/admin/festivals", { id: f.id, title: fm.title.value, descr: fm.descr.value, min_amount: numIn(fm.min.value), start: latin(fm.start.value), end: latin(fm.end.value), settle: fm.settle.value, poster, active: fm.active.checked });
    toast("ذخیره شد"); VIEWS.festivals(m);
  });
  pickImage(d, "#poster", url => { poster = url; $("#pp", d).innerHTML = thumb(url); });
}

// ---------- importer ----------
const KINDS = {
  prices: { t: "لیست قیمت", sub: "اکسل یا پی‌دی‌اف لیست قیمت؛ قیمت محصولات به‌روز می‌شود.", accept: ".xlsx,.csv,.pdf" },
  invoices: { t: "فاکتورها", sub: "اکسل یا پی‌دی‌اف فهرست فاکتورهای حسابداری؛ هر مشتری فاکتورهای خودش را در اپ می‌بیند.", accept: ".xlsx,.csv,.pdf" },
  balances: { t: "مانده حساب‌ها", sub: "اکسل یا پی‌دی‌اف مانده (یا بدهکار/بستانکار) هر مشتری.", accept: ".xlsx,.csv,.pdf" },
};
const FIELD_NAMES = { code: "کد کالا", name: "نام کالا", cust: "مشتری", no: "شماره فاکتور", date: "تاریخ", amount: "مبلغ", kind: "نوع (فروش/مرجوعی)", balance: "مانده", debit: "بدهکار", credit: "بستانکار" };
VIEWS.import = async m => {
  [S.cats] = await Promise.all([api("/api/admin/cats")]);
  const st = { kind: "prices", file: null, sheets: [], si: 0, headerRow: 0, map: {}, factor: 1, custBy: "code", pv: null };
  m.innerHTML = page("ورود فایل", "فایل را بدهید، ستون‌ها را بررسی کنید، پیش‌نمایش را ببینید و بعد ثبت کنید. تا «ثبت» نزنید چیزی عوض نمی‌شود.") + `<div class="steps">
    <div class="seg" role="group" style="max-width:520px;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:3px">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="chip" style="border:0" data-k="${k}">${v.t}</button>`).join("")}</div>
    <p class="muted" id="ksub" style="margin:0"></p>
    <label class="drop" id="drop"><b>فایل را اینجا بیندازید یا بزنید</b><span class="muted" id="facc"></span><input type="file" id="file" hidden></label>
    <div id="cfg"></div><div id="pv"></div><section class="card panel"><h2>ورودهای قبلی</h2><div id="hist" class="muted">…</div></section></div>`;
  const setKind = k => { st.kind = k; st.sheets = []; st.pv = null; $$("[data-k]").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === k)); $("#ksub").textContent = KINDS[k].sub; $("#facc").textContent = "فرمت: " + KINDS[k].accept.replaceAll(".", "").split(",").join("، "); $("#file").accept = KINDS[k].accept; $("#cfg").innerHTML = $("#pv").innerHTML = ""; };
  $$("[data-k]").forEach(b => b.onclick = () => setKind(b.dataset.k));
  setKind("prices");
  const load = async f => {
    if (!f) return; st.file = f.name; $("#cfg").innerHTML = `<p class="muted">در حال خواندن «${esc(f.name)}»…</p>`; $("#pv").innerHTML = "";
    try {
      const r = await api("/api/admin/import/read", { kind: st.kind, name: f.name, data: await fileB64(f) });
      st.sheets = r.sheets; st.si = Math.max(0, r.sheets.findIndex(s => s.guess.headerRow >= 0)); applyGuess(); drawCfg();
    } catch (e) { $("#cfg").innerHTML = `<p style="color:var(--bad)">${esc(e.message)}</p>`; }
  };
  const applyGuess = () => {
    const g = st.sheets[st.si].guess; st.headerRow = Math.max(0, g.headerRow); st.map = { ...g.map };
    if (st.kind === "prices") { const pc = g.map.price; st.map.prices = {}; delete st.map.price; const hdr = st.sheets[st.si].rows[st.headerRow] || [];
      const nz = s => String(s).replace(/[‌\s]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");
      levels().forEach((l, i) => { const byName = hdr.findIndex(h => nz(h).includes(nz(l.name))); if (byName >= 0) st.map.prices[l.k] = byName; else if (i === 0 && pc != null) st.map.prices[l.k] = pc; }); }
  };
  $("#file").onchange = e => load(e.target.files[0]);
  const drop = $("#drop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); load(e.dataTransfer.files[0]); };

  function drawCfg() {
    const sh = st.sheets[st.si], rows = sh.rows, width = Math.max(...rows.slice(0, 50).map(r => r.length), 1);
    const colName = i => { const h = rows[st.headerRow]?.[i]; return `ستون ${fa(i + 1)}${h !== undefined && h !== "" ? " — " + String(h).slice(0, 24) : ""}`; };
    const sel = (name, val, opt = true) => `<select data-map="${name}">${opt ? `<option value="">—</option>` : ""}${Array.from({ length: width }, (_, i) => `<option value="${i}" ${val === i ? "selected" : ""}>${esc(colName(i))}</option>`).join("")}</select>`;
    const fields = { prices: ["code", "name"], invoices: ["cust", "no", "date", "amount", "kind"], balances: ["cust", "balance", "debit", "credit"] }[st.kind];
    $("#cfg").innerHTML = `<section class="card panel"><h2>۱. ستون‌ها <span class="muted" style="font-weight:400;font-size:13px">(${esc(st.file)})</span></h2>
      <div class="maps">${st.sheets.length > 1 ? `<label class="field"><span>برگه</span><select id="si">${st.sheets.map((s, i) => `<option value="${i}" ${i === st.si ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>` : ""}
        <label class="field"><span>ردیف عنوان ستون‌ها</span><select id="hr">${rows.slice(0, 30).map((r, i) => `<option value="${i}" ${i === st.headerRow ? "selected" : ""}>ردیف ${fa(i + 1)}: ${esc(r.filter(c => c !== "").slice(0, 3).join(" | ").slice(0, 40))}</option>`).join("")}</select></label>
        ${fields.map(f => `<label class="field"><span>${FIELD_NAMES[f]}</span>${sel(f, st.map[f])}</label>`).join("")}
        ${st.kind === "prices" ? levels().map(l => `<label class="field"><span>قیمت «${esc(l.name)}»</span>${sel("price:" + l.k, st.map.prices?.[l.k])}</label>`).join("") : ""}
        ${st.kind !== "prices" ? `<label class="field"><span>مشتری را با چه بشناسیم؟</span><select id="cb"><option value="code" ${st.custBy === "code" ? "selected" : ""}>کد حسابداری مشتری</option><option value="name" ${st.custBy === "name" ? "selected" : ""}>نام مشتری</option></select></label>` : ""}
        ${st.kind === "balances" ? `<label class="field"><span>مانده تا تاریخ</span><input id="asof" type="text" inputmode="numeric" placeholder="امروز" dir="ltr" value="${esc(latin(faDate(new Date().toISOString())).replace(/[⁦⁩]/g, ""))}"></label>` : ""}
        <label class="field"><span>واحد مبلغ در فایل</span><select id="fx"><option value="1">همان ${esc(cur())}</option><option value="0.1" ${st.factor === 0.1 ? "selected" : ""}>ریال (÷۱۰)</option><option value="10" ${st.factor === 10 ? "selected" : ""}>تومان (×۱۰)</option></select></label></div>
      <div class="sheet scroll-x"><table><thead><tr><th>#</th>${Array.from({ length: width }, (_, i) => `<th>${fa(i + 1)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 60).map((r, i) => `<tr class="${i === st.headerRow ? "hdr" : ""}"><th>${fa(i + 1)}</th>${Array.from({ length: width }, (_, j) => `<td>${esc(r[j] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="go">پیش‌نمایش</button>${rows.length > 60 ? `<span class="muted" style="font-size:13px">${fa(rows.length)} ردیف؛ ۶۰ ردیف اول نشان داده شده</span>` : ""}</div></section>`;
    $("#si") && ($("#si").onchange = e => { st.si = +e.target.value; applyGuess(); drawCfg(); });
    $("#hr").onchange = e => { st.headerRow = +e.target.value; drawCfg(); };
    $("#fx").onchange = e => st.factor = +e.target.value;
    $("#cb") && ($("#cb").onchange = e => st.custBy = e.target.value);
    $$("[data-map]").forEach(s => s.onchange = () => {
      const v = s.value === "" ? undefined : +s.value, k = s.dataset.map;
      if (k.startsWith("price:")) { st.map.prices = st.map.prices || {}; if (v === undefined) delete st.map.prices[k.slice(6)]; else st.map.prices[k.slice(6)] = v; }
      else if (v === undefined) delete st.map[k]; else st.map[k] = v;
    });
    $("#go").onclick = preview;
  }
  const req = () => ({ kind: st.kind, rows: st.sheets[st.si].rows, headerRow: st.headerRow, map: st.map, factor: st.factor, custBy: st.custBy, file: st.file, asOf: $("#asof") ? latin($("#asof").value) : "" });
  async function preview() {
    if (st.kind === "prices" && !Object.keys(st.map.prices || {}).length) return toast("حداقل یک ستون قیمت انتخاب کنید", true);
    if (st.kind === "prices" && st.map.code == null && st.map.name == null) return toast("ستون کد یا نام کالا را انتخاب کنید", true);
    try { st.pv = await api("/api/admin/import/preview", req()); drawPv(); $("#pv").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { toast(e.message, true); }
  }
  function drawPv() {
    const pv = st.pv, s = pv.summary;
    let html = "";
    if (st.kind === "prices") {
      const ST = { new: ["جدید", "acc"], changed: ["تغییر قیمت", "warn"], same: ["بدون تغییر", ""] };
      html = `<div class="sum-row"><span class="pill warn">${fa(s.changed)} تغییر قیمت</span><span class="pill acc">${fa(s.new)} محصول جدید</span><span class="pill">${fa(s.same)} بدون تغییر</span><span class="pill bad">${fa(s.missing)} محصول در فایل نیست</span></div>
        <div class="sheet scroll-x" style="max-height:420px"><table><thead><tr><th>ردیف</th><th>وضعیت</th><th>کد</th><th>نام</th>${levels().filter(l => st.map.prices[l.k] != null).map(l => `<th>${esc(l.name)}</th>`).join("")}</tr></thead><tbody>
        ${pv.items.filter(i => i.status !== "same").concat(pv.items.filter(i => i.status === "same")).slice(0, 400).map(i => `<tr><td>${fa(i.line)}</td><td><span class="pill ${ST[i.status][1]}">${ST[i.status][0]}</span></td><td>${esc(i.code)}</td><td>${esc(i.name || i.pname)}</td>
          ${levels().filter(l => st.map.prices[l.k] != null).map(l => { const nv = i.prices[l.k], ov = i.old?.[l.k]; return `<td class="${i.status === "changed" && nv !== ov ? "chg" : ""}">${nv != null ? fa(nv) : "—"}${i.status === "changed" && ov != null && nv !== ov ? ` <s>${fa(ov)}</s>` : ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
        ${pv.missing.length ? `<details style="margin-top:10px"><summary style="cursor:pointer">محصولاتی که در فایل نیستند (${fa(pv.missing.length)})</summary><p class="muted">${pv.missing.map(p => esc(p.name)).join("، ")}</p><p class="muted" style="font-size:13px">قیمت این‌ها عوض نمی‌شود.</p></details>` : ""}
        ${s.new ? `<div class="row" style="margin-top:12px"><label class="check"><input type="checkbox" id="cn" checked> ${fa(s.new)} محصول جدید ساخته شود، در دستهٔ</label><select id="nc" style="width:auto"><option value="">بدون دسته</option>${S.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>` : ""}`;
    } else if (st.kind === "invoices") {
      html = `<div class="sum-row"><span class="pill ok">${fa(s.invoices)} فاکتور فروش</span><span class="pill warn">${fa(s.returns)} مرجوعی</span>${s.unmatched ? `<span class="pill bad">${fa(s.unmatched)} مشتری ناشناس</span>` : ""}${s.bad ? `<span class="pill bad">${fa(s.bad)} ردیف ناقص</span>` : ""}</div>
        ${pv.unmatched.length ? `<p style="color:var(--bad);font-size:14px">این مشتری‌ها در اپ پیدا نشدند؛ فاکتورشان ثبت می‌شود ولی به کسی وصل نیست تا «کد حسابداری» را در صفحهٔ مشتری‌ها بزنید و دوباره وارد کنید: ${pv.unmatched.slice(0, 30).map(esc).join("، ")}</p>` : ""}
        <div class="sheet scroll-x" style="max-height:420px"><table><thead><tr><th>شماره</th><th>نوع</th><th>مشتری</th><th>تاریخ</th><th>مبلغ (${esc(cur())})</th><th>اقلام</th></tr></thead><tbody>${pv.items.slice(0, 400).map(i => `<tr><td>${esc(i.no)}</td><td>${i.kind === "return" ? '<span class="pill warn">مرجوعی</span>' : "فروش"}</td><td>${i.uname ? esc(i.uname) : `<span class="pill bad">${esc(i.cust)}</span>`}</td><td>${i.date ? faDate(i.date) : esc(i.dateRaw) || "—"}</td><td>${fa(i.amount)}</td><td>${fa(i.lines)}</td></tr>`).join("")}</tbody></table></div>
        <p class="muted" style="font-size:13px">ردیف‌های یک فاکتور (چند کالا) با هم جمع شده‌اند. اگر فاکتوری قبلاً وارد شده باشد، به‌روز می‌شود و دوتا نمی‌شود.</p>`;
    } else {
      html = `<div class="sum-row"><span class="pill ok">${fa(s.rows - s.unmatched)} مشتری</span>${s.unmatched ? `<span class="pill bad">${fa(s.unmatched)} ناشناس (ثبت نمی‌شود)</span>` : ""}</div>
        <div class="sheet scroll-x" style="max-height:420px"><table><thead><tr><th>ردیف</th><th>مشتری</th><th>مانده (${esc(cur())})</th><th></th></tr></thead><tbody>${pv.items.slice(0, 600).map(i => `<tr><td>${fa(i.line)}</td><td>${i.uname ? esc(i.uname) : `<span class="pill bad">${esc(i.cust)}</span>`}</td><td>${fa(Math.abs(i.balance))}</td><td>${i.balance > 0 ? "بدهکار" : i.balance < 0 ? "بستانکار" : "تسویه"}</td></tr>`).join("")}</tbody></table></div>`;
    }
    const total = st.kind === "prices" ? s.changed + (s.new || 0) : st.kind === "invoices" ? s.invoices + s.returns : s.rows - s.unmatched;
    $("#pv").innerHTML = `<section class="card panel"><h2>۲. پیش‌نمایش</h2>${html}<div class="row" style="margin-top:14px"><button class="btn primary" type="button" id="ap" ${total ? "" : "disabled"}>ثبت</button><span class="muted" style="font-size:13px">${total ? "" : "چیزی برای ثبت نیست؛ ستون‌ها را بررسی کنید."}</span></div></section>`;
    $("#ap").onclick = async e => {
      if (!confirm("ثبت شود؟")) return;
      e.target.disabled = true;
      try { await api("/api/admin/import/apply", { ...req(), createNew: $("#cn")?.checked, newCat: $("#nc")?.value || null }); toast("ثبت شد"); $("#cfg").innerHTML = ""; $("#pv").innerHTML = `<p class="card panel" style="color:var(--ok);font-weight:600">ثبت شد.</p>`; hist(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
  }
  const hist = async () => { const h = await api("/api/admin/imports"); $("#hist").innerHTML = h.length ? h.map(x => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${faDate(x.at)} · ${KINDS[x.kind]?.t || x.kind} · ${esc(x.file)} · <span style="font-size:12.5px">${Object.entries(x.summary).map(([k, v]) => `${k}: ${fa(v)}`).join("، ")}</span></div>`).join("") : "هنوز چیزی وارد نشده."; };
  hist();
};

// ---------- settings ----------
VIEWS.settings = async m => {
  const s = S.settings = await api("/api/admin/settings");
  m.innerHTML = page("تنظیمات") + `<form class="card panel" id="sf" style="max-width:620px" novalidate>
    <div class="grid2"><label class="field"><span>نام برند</span><input name="brand" type="text" value="${esc(s.brand)}"></label>
    <label class="field"><span>واحد پول</span><select name="currency"><option ${s.currency === "تومان" ? "selected" : ""}>تومان</option><option ${s.currency === "ریال" ? "selected" : ""}>ریال</option></select></label>
    <label class="field"><span>تلفن روی پیش‌فاکتور</span><input name="phone" type="tel" value="${esc(s.phone)}" dir="ltr"></label></div>
    <label class="field"><span>متن پایین پیش‌فاکتور</span><textarea name="proformaNote" rows="2">${esc(s.proformaNote)}</textarea></label>
    <div class="field"><span>سطح‌های قیمت (هر مشتری یکی از این‌ها را دارد)</span><ul class="cats" id="lv">${s.levels.map(l => `<li><input type="text" value="${esc(l.name)}" data-k="${esc(l.k)}" aria-label="نام سطح"><span class="muted" dir="ltr" style="font-size:12px">${esc(l.k)}</span></li>`).join("")}</ul>
      <button class="btn sm" type="button" id="al">+ سطح جدید</button></div>
    <button class="btn primary" type="submit">ذخیره</button></form>
    <form class="card panel" id="pw" style="max-width:620px" novalidate><h2>تغییر رمز مدیر</h2><div class="grid2"><label class="field"><span>رمز فعلی</span><input name="old" type="password" dir="ltr" autocomplete="current-password"></label>
    <label class="field"><span>رمز جدید</span><input name="nw" type="password" dir="ltr" autocomplete="new-password"></label></div><button class="btn" type="submit">تغییر رمز</button></form>`;
  $("#al").onclick = () => { const used = $$("#lv input").map(i => i.dataset.k); const k = "ABCDEFGHIJ".split("").find(c => !used.includes(c)); if (!k) return; $("#lv").insertAdjacentHTML("beforeend", `<li><input type="text" data-k="${k}" placeholder="نام سطح"><span class="muted" dir="ltr" style="font-size:12px">${k}</span></li>`); };
  $("#sf").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { S.settings = await api("/api/admin/settings", { brand: f.brand.value, currency: f.currency.value, phone: latin(f.phone.value), proformaNote: f.proformaNote.value, levels: $$("#lv input").map(i => ({ k: i.dataset.k, name: i.value })).filter(l => l.name.trim()) }); toast("ذخیره شد"); VIEWS.settings(m); }
    catch (err) { toast(err.message, true); }
  };
  $("#pw").onsubmit = async e => { e.preventDefault(); try { await api("/api/password", { old: latin(e.target.old.value), new: latin(e.target.nw.value) }); toast("رمز عوض شد"); e.target.reset(); } catch (err) { toast(err.message, true); } };
};

// ---------- boot ----------
async function boot() {
  if (!token.get()) return loginView();
  try {
    const me = await api("/api/me");
    if (me.user.role !== "admin") { token.set(""); return loginView("این حساب مشتری است؛ با حساب مدیر وارد شوید."); }
    S.me = me.user; S.settings = me.settings;
    shell(); refreshBadge(); route();
  } catch (e) { loginView(e.message); }
}
window.addEventListener("hashchange", () => { if ($("#main")) route(); });
boot();
