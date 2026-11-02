# Deploying TERAGO ONLINE

The game has two pieces that need two different hosts:

- **Client** (what plays in a browser) — a static build, fine for Vercel.
- **Server** (WebSocket connections + a 20 Hz game loop + SQLite) — needs a
  host that runs a real, always-on process with a persistent connection.
  Vercel only runs short-lived serverless functions with no long-lived
  connections and no writable disk, so it **cannot** run this half, no
  matter how it's configured.

So "deploy it on Vercel" really means: client on Vercel, server somewhere
that supports a real process (this repo is already set up for **Render**,
below - any host that runs `npm install && npm start`-style Node works the
same way).

These steps need your own Vercel/Render accounts - there's no way to run
them from here.

## 1. Deploy the server (Render)

1. [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints) → **New Blueprint Instance**.
2. Pick this repo (`jaymartinortega20/terrago`). Render reads `render.yaml`
   at the repo root automatically - no settings to fill in.
3. **Apply**, wait for the first deploy, then copy the service's URL
   (looks like `https://terrago-server-xxxx.onrender.com`).

**Free-tier note:** Render's free web services don't keep a persistent disk
and spin down after ~15 minutes idle, so the SQLite database resets on
every restart - accounts/characters won't persist long-term. The game is
still fully playable multiplayer, it just won't remember anyone forever on
the free tier. For real persistence, attach a paid disk in Render's
dashboard mounted at `/data` and set `TERAGO_DB_PATH=/data/terago.sqlite`.

## 2. Deploy the client (Vercel)

1. [vercel.com/new](https://vercel.com/new) → import this repo.
2. Leave **Root Directory** as the repo root (not `client`) - `vercel.json`
   there already sets the build command and output directory for the
   monorepo.
3. Before the first deploy, add one environment variable:
   - `VITE_WS_URL` = `wss://<the Render URL from step 1>` - note `wss://`,
     not `https://`.
4. Deploy. If the project is named `terrago-one`, it lands at
   `terrago-one.vercel.app`.

## If the server's URL ever changes

`VITE_WS_URL` is baked into the client at *build* time, not read at
runtime - update it in Vercel's project settings and redeploy the client
(Vercel → Deployments → Redeploy), not just the server.
