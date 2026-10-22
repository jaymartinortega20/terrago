# Running TerraGo: backups, monitoring, logs

Everything here is free. Do these once before inviting players.

## 1. Backups (two layers)

**Neon (automatic).** Neon keeps a short history of your database and can
restore it to an earlier moment ("point-in-time restore"):
Neon console → your project → **Branches** → **Restore**. Check how far back
your plan goes under **Settings → Storage / History retention**.

**Nightly copy on GitHub (recommended).** The repo includes
`.github/workflows/backup.yml`. It does nothing until you turn it on:

1. GitHub → your `terrago` repo → **Settings → Secrets and variables → Actions**.
2. **New repository secret** — name `DATABASE_URL`, value: your Neon connection
   string (the same one Render uses). It stays secret; never paste it in chat.
3. **Actions** tab → *Nightly backup* → **Run workflow** to test it.

Each night a `.dump` file is saved under that run's *Artifacts* for 30 days.

**Restoring a dump** (only if something went badly wrong):
`pg_restore --clean --no-owner -d "<connection string>" terrago-YYYY-MM-DD.dump`

## 2. Monitoring

- **Render health check** is already set (`/healthz`). Render restarts the
  server if it stops answering.
- **Get alerted when it's down:** create a free monitor at uptimerobot.com
  (HTTP(s), every 5 minutes) for `https://<your-render-app>.onrender.com/healthz`.
  Add your email as the alert contact.
- **Free plan note:** Render's free server sleeps after ~15 minutes with no
  visitors and takes ~30–60 s to wake. The uptime monitor pinging every 5
  minutes keeps it awake.
- **Server numbers:** `/metrics` (tick time, players, sockets, DB) — set a
  `METRICS_TOKEN` environment variable on Render and send it as the
  `x-metrics-token` header.

## 3. Logs

Render → your service → **Logs**. Every line is JSON. Useful searches:
`join_failed`, `tick_error`, `kill_rewards_failed`, `socket_flood`,
`player_reported`, `achievement_unlocked`.

## 4. Before an update

Pushing to `main` deploys automatically. Database changes (migrations) run
by themselves when the server starts. Bigger updates: run the backup workflow
first (Actions → Run workflow).

## 5. Admin panel (`/admin`)

Only accounts whose email is in `ADMIN_EMAILS` on Render (or that have the admin role) can open it.

- **Economy** — Gold created and removed by source and sink, a daily chart, how much Gold exists, marketplace/stall/trade volume, the most traded items with prices, rare items created, and suspicious transactions (gold given away for nothing, sales far above the usual price, very large moves). If *Net change* stays strongly positive for weeks, the economy is inflating: add sinks or reduce rewards.
- **Flags** — anti-bot and security signals. Nothing is ever banned automatically: mark each as *It's fine* or *Handled* with a note.
- **Players** — search, then **Details** for inventory and bank, Gold and item history, trades, market sales, flags, reports and the account's other characters. Mute, ban, kick and give from there.
- **Tools** — server-wide announcement; start or stop any world event (it reaches everyone immediately); message of the day; XP rate (×1–×3); open or close new sign-ups (useful during an attack or maintenance).

Every admin action is recorded in the **Log** tab.

## 6. Load test

`npm run loadtest -- --bots 100 --duration 60` against a non-production server started with `DISABLE_RATE_LIMITS=true`. Last run (October 2026): 100 bots, 0 errors, 0 disconnects, socket round-trip p99 6 ms, server CPU ~15%, memory ~257 MB, no database queueing.
