import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* Symmetric encryption for third-party secrets we must store (connection
 * client secrets and tokens). AES-256-GCM, random 12-byte IV per value,
 * auth tag checked on decrypt so a tampered row fails loudly.
 *
 * Stored format:  v1:<iv b64>:<tag b64>:<ciphertext b64>
 * Key:            CONNECTIONS_KEY — 32 bytes, base64 (legacy name
 *                 ZOHO_CREDENTIALS_KEY is still accepted)
 *                 (generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
 * Losing the key makes stored credentials unreadable (re-add the connection);
 * it is never written to the database. */

function key(): Buffer {
  const raw = process.env.CONNECTIONS_KEY || process.env.ZOHO_CREDENTIALS_KEY;
  if (!raw) throw new Error("CONNECTIONS_KEY is not set — required to store or read connection secrets");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("CONNECTIONS_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Stored secret has an unknown format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** "1000.d233…7051" → "1000.d2…51" — for showing which secret is stored. */
export function maskSecret(plain: string): string {
  if (plain.length <= 10) return "••••";
  return `${plain.slice(0, 7)}…${plain.slice(-2)}`;
}

/** Encrypt a whole JSON value (a connection's secrets blob). */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(stored: string): T {
  return JSON.parse(decryptSecret(stored)) as T;
}
