// Encode/decode the pending parse into the confirmation message body.
// Serverless functions don't share memory and callback_data is capped at 64 bytes,
// so the parsed items ride inside the message text and are read back on confirm.

const MARKER = "__BBDATA__";
const MARKER_RE = /__BBDATA__([A-Za-z0-9+/=]+)/;

/** Build the hidden, spoiler-wrapped payload appended to a confirmation message. */
export function encodePayload(items) {
  const b64 = Buffer.from(JSON.stringify(items), "utf8").toString("base64");
  return `\n\n<tg-spoiler>${MARKER}${b64}</tg-spoiler>`;
}

/** Extract and decode items from a message's text. Returns array or null. */
export function decodePayload(messageText) {
  if (!messageText) return null;
  const m = messageText.match(MARKER_RE);
  if (!m) return null;
  try {
    const json = Buffer.from(m[1], "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True if a message still carries an un-consumed payload (i.e. not yet logged). */
export function hasPayload(messageText) {
  return !!messageText && MARKER_RE.test(messageText);
}
