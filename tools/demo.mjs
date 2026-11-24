// Sample data for the test version only: placeholder products and prices, NOT SAM's real list.
// Run: npm start -- --demo   (adds nothing if products already exist)
import { hash } from "../lib/pass.mjs";

export function seed(db) {
  if (db.prepare("SELECT 1 FROM products").get()) return;
  const cats = ["اصلاح", "مو", "پوست", "بدن", "خوشبو‌کننده"];
  const cid = cats.map((n, i) => Number(db.prepare("INSERT INTO cats(name,sort) VALUES(?,?)").run(n, i).lastInsertRowid));
  const P = [
    ["S-101", "فوم اصلاح (نمونه)", 0, 12, 185000], ["S-102", "ژل اصلاح (نمونه)", 0, 12, 210000], ["S-103", "افترشیو (نمونه)", 0, 6, 320000],
    ["H-201", "شامپو مو (نمونه)", 1, 12, 240000], ["H-202", "واکس مو (نمونه)", 1, 24, 195000], ["H-203", "ژل مو (نمونه)", 1, 24, 150000],
    ["K-301", "کرم مرطوب‌کننده (نمونه)", 2, 12, 290000], ["K-302", "شوینده صورت (نمونه)", 2, 12, 260000],
    ["B-401", "شامپو بدن (نمونه)", 3, 12, 230000], ["B-402", "دئودورانت (نمونه)", 4, 24, 175000], ["B-403", "اسپری بدن (نمونه)", 4, 24, 205000],
  ];
  for (const [code, name, c, pack, a] of P) db.prepare("INSERT INTO products(code,name,cat,pack,prices) VALUES(?,?,?,?,?)").run(code, name, cid[c], pack, JSON.stringify({ A: a, B: Math.round(a * 1.06 / 1000) * 1000, C: Math.round(a * 1.15 / 1000) * 1000 }));
  const u = db.prepare("INSERT INTO users(role,username,pass,name,contact,phone,city,code,level) VALUES('customer',?,?,?,?,?,?,?,?)");
  u.run("demo", hash("demo1234"), "فروشگاه نمونه", "", "", "تهران", "1001", "A");
  u.run("demo2", hash("demo1234"), "عمده‌فروشی نمونه", "", "", "اصفهان", "1002", "B");
  const d = new Date(), iso = n => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
  db.prepare("INSERT INTO festivals(title,descr,min_amount,start,end,settle) VALUES(?,?,?,?,?,?)").run("جشنواره نمونه", "این یک جشنوارهٔ آزمایشی است؛ متن و شرایط واقعی را تیم سام وارد می‌کند.", 50000000, iso(-3), iso(27), "متن نمونه برای نحوهٔ تسویه");
  console.log("demo data added (customer: demo / demo1234)");
}
