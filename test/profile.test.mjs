import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sam-prof-"));
process.env.DATA_DIR = dir; process.env.ADMIN_PASS = "admin-pass";
const { openDb, createApp, ensureAdmin } = await import("../server.mjs");
const { seed } = await import("../tools/demo.mjs");
const db = openDb(path.join(dir, "t.db")); ensureAdmin(db); seed(db);
const srv = http.createServer(createApp(db)).listen(0), base = `http://127.0.0.1:${srv.address().port}`;
const call = async (p, body, tok) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };

test("profile: change own username and password, with the current password", async () => {
  const t = (await call("/api/login", { u: "demo", p: "demo1234" })).token;
  assert.equal((await call("/api/profile", { username: "shop1", old: "wrong" }, t)).status, 400, "current password required");
  assert.equal((await call("/api/profile", { username: "demo2", old: "demo1234" }, t)).status, 400, "taken username refused");
  assert.equal((await call("/api/profile", { username: "x", old: "demo1234" }, t)).status, 400, "bad username refused");
  const r = await call("/api/profile", { username: "Shop.One", new: "newpass1", old: "demo1234" }, t);
  assert.equal(r.user.username, "shop.one");
  assert.equal((await call("/api/login", { u: "demo", p: "demo1234" })).status, 401);
  assert.ok((await call("/api/login", { u: "shop.one", p: "newpass1" })).token, "new login works");
  const a = (await call("/api/login", { u: "admin", p: "admin-pass" })).token;
  assert.equal((await call("/api/profile", { username: "boss", old: "admin-pass" }, a)).user.username, "boss", "managers too");
});

test.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
