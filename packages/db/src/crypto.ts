import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// 32-byte hex key from env, never stored in DB
const ENCRYPTION_KEY = Buffer.from(process.env["ENCRYPTION_KEY"] ?? "", "hex")

export function encryptTokens(tokens: object): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, ct, tag].map(b => b.toString("base64")).join(".")
}

export function decryptTokens<T = unknown>(encrypted: string): T {
  const parts = encrypted.split(".")
  if (parts.length !== 3) throw new Error("invalid encrypted token format")
  const [ivB64, ctB64, tagB64] = parts as [string, string, string]
  const iv = Buffer.from(ivB64, "base64")
  const ct = Buffer.from(ctB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(plaintext.toString("utf8")) as T
}
