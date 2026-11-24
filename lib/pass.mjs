// Password hashing (scrypt + salt) and checking.
import crypto from "node:crypto";
export const hash = (p, salt = crypto.randomBytes(16).toString("hex")) => salt + ":" + crypto.scryptSync(String(p), salt, 32).toString("hex");
export const checkPass = (p, h) => { const [salt, k] = String(h).split(":"); const a = Buffer.from(hash(p, salt).split(":")[1], "hex"), b = Buffer.from(k || "", "hex"); return a.length === b.length && crypto.timingSafeEqual(a, b); };
