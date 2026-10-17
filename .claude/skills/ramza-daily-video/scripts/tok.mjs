import fs from "node:fs"; import crypto from "node:crypto";
const env = fs.readFileSync(process.env.OMNIA_ENV ?? new URL("../../../../.env", import.meta.url), "utf8");
const secret = (env.match(/^OMNIA_SESSION_SECRET=(.*)$/m)?.[1] ?? "dev-only-change-me-in-prod").replace(/^["']|["']$/g, "");
const p = Buffer.from(JSON.stringify({ username: "founder", role: "admin", exp: Date.now() + 864e5 })).toString("base64url");
console.log(`${p}.${crypto.createHmac("sha256", secret).update(p).digest("base64url")}`);
