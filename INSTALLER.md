# Pulse Installer — new-client provisioning runbook

**Target: a new client live in under one hour.** Every client gets their own instance:
own Supabase project, own Vercel deployment, own domain, own branding, own data.

## 0 · You need
Free accounts on GitHub (this repo), **Supabase**, and **Vercel**. Nothing else.

## 1 · Database (≈5 min)
1. supabase.com → **New project**. Name it after the client, strong DB password (save it),
   region closest to the client.
2. SQL Editor → **New query** → paste **`supabase/setup.sql`** → **Run**.
   One file = full schema + industry-neutral starter seed (no users, no client strings).
3. Project Settings → Database → **Connection pooling** → copy the **Transaction** pooler
   URI (ends `…pooler.supabase.com:6543`) and put the real password in it.

## 2 · Deploy (≈5 min)
1. vercel.com → **Add New → Project** → import this repo (Root Directory = `./`;
   `vercel.json` drives the build — don't override).
2. Environment variables:
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the pooled URI from step 1.3 |
   | `JWT_SECRET` | `openssl rand -base64 32` |
   | `CRON_SECRET` | another random string — activates the 05:00 Daily Pulse |
   | `ANTHROPIC_API_KEY` | *(optional)* activates the AI Brain |
3. **Deploy** (~2 min), then attach the client's domain if any.

## 3 · First run (≈5 min)
1. Open the URL → the **Pulse installer** appears (it only exists while the instance has
   zero users — it locks itself permanently after the first admin).
2. Enter the organization names (AR/EN) and the first admin account → **Create & launch**.
3. The **onboarding wizard** opens: logo URL, accent color (the whole UI re-themes live),
   local currency + rate, business units, module toggles → **Launch Pulse**.
4. Settings → verify. Users → create the team. Done.

## 4 · Demo instances only
Run `supabase/seed-demo.sql` in the SQL Editor (wipes app data, loads the Saria flagship
dataset). Logins `head@saria.sd` … `content@saria.sd`, password **`Pulse@2026`**.
Never run this on a real client.

## 5 · Smoke test (2 min)
- `/{api}/health` → `{ ok: true, service: "Pulse API", db: "configured" }`
- Log in → dashboard renders with the client accent → create a campaign → delete it.
- Settings → toggle a module off → its nav entry disappears; its API 404s; toggle back.
- Market Intel → **Refresh all** pulls live public signals (no API keys needed).

## 6 · Upgrades (fleet-wide)
Pull the release → run `supabase/migrations/APPLY-LATEST.sql` once per instance
(idempotent, cumulative). Vercel redeploys on push automatically.

## Troubleshooting
- **Deploy button greyed** → empty env-var row or Root Directory ≠ `./`.
- **500s with "DATABASE_URL is not set"** → env var missing/typo'd; use the *pooled* 6543 URI.
- **Installer doesn't appear** → the DB already has users (it's not a fresh instance).
- **Wizard reappears** → `settings.onboarded` is false; finishing (or Skip) sets it.

---

## Step: generate the instance encryption key (SEC·A)

Every Pulse instance encrypts its stored credentials with **its own key**. The key lives only in the instance's environment — never in the database, never in the repository, never in a backup.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set the result as `PULSE_SECRET_KEY_V1` in the instance environment (Vercel project settings, or the Docker env file).

Then, on an existing instance that already holds credentials:

```bash
npm run secrets:audit      # what is still unprotected?
npm run secrets:migrate    # encrypt tokens, hash magic-link tokens
npm run secrets:audit      # must report zero
```

The migration is idempotent and round-trips every value before writing it, so a re-run is safe and a partial run resumes.

**Losing this key means losing every stored integration credential** — they would have to be reconnected. Store it wherever the client keeps their other production secrets.

**Rotation.** Add `PULSE_SECRET_KEY_V2`, run `npm run secrets:rotate`, then remove `V1` once the audit shows no `enc:v1:` values remain. Old ciphertexts stay readable throughout.

Check `GET /api/health` after deploying: the `crypto` block reports the active key version and how many values remain unprotected.
