// Encode/decode the pending parse into the confirmation message — invisibly.
// Serverless functions don't share memory and callback_data is capped at 64 bytes,
// so the parsed items ride along inside a hidden link entity: a zero-width character
// whose text_link URL carries the base64url payload. The user sees nothing; on confirm
// we read the URL back from message.entities. Editing the message later drops the
// entity, which is the idempotency mechanism.

const ZW = "\u2063"; // invisible separator — the (empty-looking) link text
const URL_PREFIX = "https://t.me/?bbdata=";

/** Build the hidden HTML anchor appended to a confirmation message. */
export function encodePayload(items) {
  const b64 = Buffer.from(JSON.stringify(items), "utf8").toString("base64url");
  return `<a href="${URL_PREFIX}${b64}">${ZW}</a>`;
}

/** Extract and decode items from a Telegram message object. Returns array or null. */
export function decodePayload(message) {
  const entities = (message && message.entities) || [];
  for (const e of entities) {
    if (e.type === "text_link" && typeof e.url === "string" && e.url.startsWith(URL_PREFIX)) {
      const b64 = e.url.slice(URL_PREFIX.length);
      try {
        const json = Buffer.from(b64, "base64url").toString("utf8");
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** True if a message still carries an un-consumed payload (i.e. not yet logged). */
export function hasPayload(message) {
  return decodePayload(message) !== null;
}

/** Escape text destined for an HTML-parse-mode message (the dynamic receipt body). */
export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

