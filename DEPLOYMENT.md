# HELM — Implementation & Deployment (step by step)

Two paths. Pick one:
- **A. Vercel + Supabase** — fastest, no server to manage (recommended).
- **B. Docker on your own server** — fully self-hosted / sovereign.

Demo login after either: `head@saria.sd` / `Helm@2026`.

---

## A. Vercel + Supabase  (~15 minutes)

You need free accounts on **GitHub**, **Supabase**, and **Vercel**.

### 1. Put the code in a Git repo
```bash
unzip helm.zip && cd helm
git init && git add . && git commit -m "HELM"
# create an empty repo on GitHub, then:
git remote add origin https://github.com/<you>/helm.git
git branch -M main && git push -u origin main
```
`.gitignore` already excludes `node_modules`, `.env`, build output.

### 2. Create the database (Supabase)
1. supabase.com → **New project**. Set a name, a strong **database password** (save it), a region close to Sudan (e.g. Frankfurt). Wait ~2 min for provisioning.
2. Left sidebar → **SQL Editor** → **New query**. Paste the contents of `supabase/schema.sql`, press **Run**. (Creates all tables.)
3. New query again → paste `supabase/seed.sql` → **Run**. (Demo users, sample data, starter watch-topics.)
4. Get the connection string: **Project Settings** (gear icon) → **Database** → **Connection string** → **Connection pooling** tab → copy the **Transaction** pooler URI (host ends in `...pooler.supabase.com:6543`). Replace `[YOUR-PASSWORD]` in it with your database password.
   - Use the **pooled (6543)** string, not the direct **5432** one — serverless needs the pooler.

### 3. Deploy (Vercel)
1. vercel.com → **Add New → Project** → **Import** your GitHub repo.
2. Vercel reads `vercel.json` automatically (build command, output dir, the `/api` function). If it asks for a framework preset, choose **Other**; don't override build settings.
3. Open **Environment Variables** and add two:
   - `DATABASE_URL` = the pooled Supabase URI from step 2.4
   - `JWT_SECRET` = a long random string. Generate one with: `openssl rand -base64 32`
4. Click **Deploy**. Wait ~1–2 min.

### 4. First sign-in
1. Open the deployment URL → log in with `head@saria.sd` / `Helm@2026`.
2. **Users** → create your real team accounts → then deactivate the demo users.
3. **Settings** → set the real USD→SDG rate and org name.
4. **Market Intel** → press **Refresh all** to pull live news/GDELT signals (works immediately, no API keys).

### 5. Updating later
Push to the Git repo; Vercel redeploys automatically. Schema changes: re-run the new SQL in Supabase's SQL Editor.

---

## B. Docker on your own server (self-hosted)

You need a server with **Docker** + **Docker Compose**. No Supabase, no Node — HELM runs with its own Postgres in a container; data stays on your machine.

```bash
unzip helm.zip && cd helm
# 1. edit docker-compose.yml -> change JWT_SECRET to a strong secret
# 2. start (builds frontend, runs API + Postgres, seeds on first boot)
docker compose up --build -d
# 3. open http://<server-ip>:4000
```
- First sign-in steps are the same as A.4 above.
- **HTTPS:** put nginx or Caddy in front of port 4000 for a real domain + TLS.
- **Backups:** the database lives in `./data/pg` — back up that folder, or run
  `docker exec helm-db pg_dump -U helm helm > helm-backup.sql`.
- **Update:** `git pull` (or re-unzip) then `docker compose up --build -d`. Schema uses
  `IF NOT EXISTS`, so restarts are safe and won't wipe data.

---

## Optional: run locally first (to try before deploying)

Needs **Node 18+**. Point `DATABASE_URL` at any Postgres (a Supabase project is easiest).
```bash
# Backend
cd backend
npm install
cp ../.env.example .env          # set DATABASE_URL + JWT_SECRET
npm run seed                     # applies schema + demo data to DATABASE_URL
npm run dev                      # API on http://localhost:4000

# Frontend (second terminal)
cd frontend
npm install
npm run dev                      # app on http://localhost:5173
```
`npm run db:apply` applies the schema only (no demo data).

---

## What still needs your own credentials (later, optional)

- **Live social sync** (Facebook / TikTok / X / LinkedIn): each needs your own developer
  app + access token. Until then, use **CSV import** on the Social screen. See README.
- **Scheduled Market-Intel refresh:** the in-app **Refresh** works now. Automating it on a
  timer needs a small cron-token endpoint (the refresh route is auth-protected) — ask and
  it can be added.

---

## Quick troubleshooting

- **Login fails right after deploy** → the SQL seed didn't run, or `DATABASE_URL` is wrong/uses the non-pooled port. Re-check step 2.
- **API 500s on Vercel** → confirm both env vars are set, and that the connection string is the **pooled 6543** one.
- **Arabic looks reversed in exports** → open CSVs in Excel; the UTF-8 BOM handles RTL. In Google Sheets, import as UTF-8.
- **Market Intel returns no signals** → press Refresh; if a source errors it's reported per-source. Live fetch needs outbound internet (always available on Vercel / your server).
