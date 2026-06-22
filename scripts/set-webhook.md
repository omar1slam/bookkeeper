# Telegram webhook setup

Replace `<TOKEN>`, `<your-vercel-app>`, and `<TELEGRAM_WEBHOOK_SECRET>` with real values.
The secret must match the `TELEGRAM_WEBHOOK_SECRET` env var in Vercel.

## Register the webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-vercel-app>.vercel.app/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```

## Inspect the current webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## Remove the webhook (e.g. to debug locally)

```bash
curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

## First-run bootstrap (get your chat ID)

1. Leave `ALLOWED_CHAT_ID` empty in Vercel and deploy.
2. Send any message to the bot. It replies with `Your chat ID is <id>`.
3. Set `ALLOWED_CHAT_ID=<id>` in Vercel → Environment Variables and redeploy.
