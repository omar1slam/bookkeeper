# Budget Bot

A Telegram bot that logs expenses written in natural language (English + transliterated
Egyptian Arabic). An LLM parses each message into structured items; after a confirmation
tap, the bot appends the amount to the correct `ACTUAL` formula cell in a Google Sheet
**and** writes a full row to a `Transactions` ledger tab.

## How it works

```
Telegram message → /api/telegram (Vercel)
  → allowlist + webhook-secret check
  → command? (/start /help /undo /today /month) → handle
  → LLM parse → structured items
  → confirmation message with [✓ Confirm] [✗ Cancel]  (parse encoded into the message, stateless)
On confirm:
  → decode pending parse from the message
  → resolve target cell (label + section, drift-resistant) → append +amount to the formula
  → append a row to Transactions
  → edit message to a final receipt (idempotent)
```

## Project layout

```
budget-bot/
├── api/telegram.js          # Vercel serverless webhook entry point
├── lib/
│   ├── telegram.js          # Telegram Bot API helpers
│   ├── parse.js             # LLM parsing (anthropic | gemini)
│   ├── sheets.js            # Google Sheets REST wrapper
│   ├── categories.js        # canonical category → sheet-label map
│   ├── resolve.js           # target-cell resolution (label + section)
│   ├── formula.js           # appendAmount() + removeLastTerm()
│   ├── ledger.js            # Transactions tab helpers
│   └── payload.js           # encode/decode pending parse into the message
├── scripts/set-webhook.md
├── .env.example
├── package.json
└── vercel.json
```

ES modules throughout; relative imports include the `.js` extension (Vercel ESM
requirement). The only dependency is `google-auth-library`; Anthropic, Gemini, and
Telegram are called via the global `fetch` (Node 20).

## Setup

1. `npm install`
2. Push to GitHub and import into Vercel (or use the `vercel` CLI).
3. Add the environment variables (see `.env.example`) in Vercel → Settings →
   Environment Variables. Paste the **full** service-account JSON, single line, into
   `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. Deploy and note the production URL.
5. Register the webhook — see `scripts/set-webhook.md`.
6. Message the bot once → it replies with your chat ID → set `ALLOWED_CHAT_ID` → redeploy.
7. Confirm the sheet is shared with the service-account email as **Editor** and the
   **Google Sheets API is enabled** in the GCP project.

## Environment variables

| Var | Purpose |
| --- | --- |
| `TELEGRAM_TOKEN` | Bot token |
| `TELEGRAM_WEBHOOK_SECRET` | Random string; set on setWebhook; verified per request |
| `LLM_PROVIDER` | `anthropic` (default) or `gemini` |
| `ANTHROPIC_API_KEY` | If provider = anthropic |
| `ANTHROPIC_MODEL` | Default `claude-haiku-4-5-20251001` |
| `GEMINI_API_KEY` | If provider = gemini |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full service-account JSON, single line |
| `SHEET_ID` | Google Sheet ID |
| `ALLOWED_CHAT_ID` | Comma-separated allowed Telegram chat IDs |
| `DEFAULT_TZ` | `Africa/Cairo` |
| `DEFAULT_CURRENCY` | `EGP` |

## Commands

- `/start`, `/help` — usage + examples.
- `/undo` — remove the last logged expense from its cell and delete the ledger row.
- `/today` — today's total (from the ledger).
- `/month` — current month tab's grand-total ACTUAL.

## Security notes

- Secrets live only in Vercel env vars — never in source or commits.
- Rotate the Telegram bot token (BotFather `/revoke`) and the Anthropic key before deploy.
- The webhook verifies `X-Telegram-Bot-Api-Secret-Token` on every request.
- Only allowlisted chat IDs are served; others are ignored.

## Correctness core

- **Never hardcode rows.** Rows are resolved at write time by matching the label in
  column G, scoped to the correct section. Layouts differ across months.
- The bot writes only to column I leaf cells (and column G labels for new freeform rows).
  It never writes to SUM/summary cells or columns H/J/K/L.
