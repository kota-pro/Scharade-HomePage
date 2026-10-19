import crypto from "node:crypto";

/** Fresh transport nonce for each attempt; business request IDs stay unchanged. */
export function signedEnvelope(value: object, secret: string) {
  if (secret.length < 32) throw new Error("configuration");
  const timestamp = String(Date.now()), nonce = crypto.randomBytes(16).toString("hex"), payload = JSON.stringify(value);
  const signature = crypto.createHmac("sha256", secret).update(`v2\n${timestamp}\n${nonce}\n${payload}`).digest("hex");
  return { version: 2, timestamp, nonce, payload, signature };
}
