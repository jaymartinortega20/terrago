# Put TerraGo online for free (no domain needed)

| Part | Service | Free-plan notes |
| --- | --- | --- |
| Website + game client | Vercel | Always on |
| Game server (the 24/7 world) | Render | Sleeps after 15 min with nobody connected; the next visitor waits about a minute while it wakes |
| Database | Neon (PostgreSQL) | 0.5 GB, plenty for testing |
| Code | GitHub | Render and Vercel deploy from it |

The website and the game server end up on different sites (`*.vercel.app` and `*.onrender.com`). That works because the website forwards its `/api` calls to the game server (so the login cookie belongs to the website), and the game connection uses a one-time 60-second pass. When you later buy a domain and a VPS, follow `docs/deployment.md` instead; nothing in the game changes.

## 1. GitHub
1. Create a free account at github.com.
2. Create an **empty** repository named `terrago` (no README).
3. Push the code to it (Claude can do this for you once the repository exists).

## 2. Neon (database)
1. Sign up at neon.tech (you can use your GitHub account).
2. Create a project: name `terrago`, region **AWS Asia Pacific (Singapore)**.
3. Copy the connection string (it looks like `postgresql://user:password@ep-....ap-southeast-1.aws.neon.tech/neondb?sslmode=require`). Keep it secret.

## 3. Render (game server)
1. Sign up at render.com with your GitHub account.
2. **New → Blueprint**, choose the `terrago` repository. Render reads `render.yaml`.
3. Fill in:
   * `DATABASE_URL` = the Neon connection string.
   * `WEB_ORIGINS` = `https://terrago.vercel.app` (your Vercel address from step 4; you can come back and change it).
4. Deploy. When it is live, open `https://<your-service>.onrender.com/healthz` — it should say `"status":"healthy"`. Copy the service address.

## 4. Vercel (website)
1. **Add New → Project**, import the `terrago` repository.
2. **Root Directory:** `apps/web` (framework: Next.js; leave "Include files outside the root directory" on).
3. **Environment variable:** `NEXT_PUBLIC_GAME_SERVER_URL` = your Render address, e.g. `https://terrago-game-server.onrender.com` (no trailing slash).
4. Deploy. Your game is at `https://<project>.vercel.app`.
5. If that address differs from what you put in Render's `WEB_ORIGINS`, update `WEB_ORIGINS` on Render (Environment tab) and let it redeploy.

## 5. Play
Open your Vercel address in two browsers (or send it to a friend), create accounts and meet at the fountain. If the first load says "Reconnecting…", the free game server is waking up — give it a minute.

## Troubleshooting
* **"Origin not allowed" when logging in:** `WEB_ORIGINS` on Render must exactly match the address in your browser bar (https, no trailing slash). Several addresses can be listed, separated by commas.
* **"Can't reach the TerraGo server":** check `NEXT_PUBLIC_GAME_SERVER_URL` on Vercel, then redeploy Vercel (the value is built into the site).
* **Database errors on Render:** make sure the Neon string ends with `?sslmode=require`. If it also contains `&channel_binding=require` and Render reports an authentication error, remove that part.
* Render logs (Logs tab) are JSON lines; look for `startup_failed` or `error`.
