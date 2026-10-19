# Deploying TerraGo

TerraGo uses a split deployment:

* **Vercel** hosts the Next.js website and the Phaser client (static assets + pages).
* **A VPS** (Singapore or near your players) runs the persistent, authoritative game server, PostgreSQL and Caddy for HTTPS/WSS.

Vercel Functions are never used as the game world: the world is a long-lived process with in-memory state and WebSockets.

## 1. Domains

Use one registrable domain for both halves so the session cookie is first-party:

| Part | Example |
| --- | --- |
| Website (Vercel) | `https://terrago.gg` |
| Game server (VPS) | `https://api.terrago.gg` |

`localhost:3000` → `localhost:4000` works the same way in development.

## 2. VPS (game server + database)

Tested shape: 2 vCPU / 4 GB RAM Ubuntu, Docker installed.

```bash
git clone <your repo> /opt/terrago && cd /opt/terrago
cp deploy/.env.production.example deploy/.env.production
# edit: API_DOMAIN, WEB_ORIGINS, POSTGRES_PASSWORD (long random), METRICS_TOKEN
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

* Point an `A` record for `api.terrago.gg` at the VPS before starting; Caddy obtains the certificate automatically.
* Migrations run on server start (advisory-locked, safe to restart).
* Health: `curl https://api.terrago.gg/healthz`.
* Metrics: `curl -H "X-Metrics-Token: $METRICS_TOKEN" https://api.terrago.gg/metrics`.
* Logs: `docker compose -f deploy/docker-compose.prod.yml logs -f game-server` (JSON lines).
* Firewall: allow 22, 80, 443 only. PostgreSQL is not published.

### Backups

```bash
crontab -e
15 3 * * * /opt/terrago/deploy/backup.sh >> /var/log/terrago-backup.log 2>&1
```

The script writes a compressed `pg_dump`, verifies it with `pg_restore --list` and keeps 14 days. Copy dumps off the VPS (rclone to S3/B2). **Test a restore** regularly:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T db \
  createdb -U terrago terrago_restore_test
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T db \
  pg_restore -U terrago -d terrago_restore_test < /var/backups/terrago/terrago-<stamp>.dump
```

### Updating

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build game-server
```

SIGTERM triggers a graceful shutdown: players are told the server is restarting and every position is saved.

## 3. Vercel (website + client)

1. Import the repository in Vercel.
2. **Root Directory:** `apps/web` (keep "Include files outside the root directory" enabled — the client uses the shared workspace packages).
3. Framework preset: Next.js. Install command: `npm install` (run at the monorepo root automatically).
4. Environment variable: `NEXT_PUBLIC_GAME_SERVER_URL=https://api.terrago.gg`.
5. Add the `terrago.gg` domain.

The site's Content-Security-Policy allows connections to exactly that game server URL.

## 4. Production checklist

- [ ] `WEB_ORIGINS` lists only your real site origins.
- [ ] `NODE_ENV=production` (forces Secure cookies and rate limits on).
- [ ] Strong `POSTGRES_PASSWORD` and `METRICS_TOKEN`; `.env.production` not in git.
- [ ] Backups scheduled and copied off-site; restore tested.
- [ ] Load test run on the real VPS hardware before announcing capacity: start a **staging** copy (separate database) with `NODE_ENV=development COOKIE_SECURE=true DISABLE_RATE_LIMITS=true`, then `npm run loadtest -- --server https://staging-api.terrago.gg --origin https://terrago.gg`. Rate limits cannot be disabled when `NODE_ENV=production`.
