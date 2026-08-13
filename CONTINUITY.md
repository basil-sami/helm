# CONTINUITY — If the Founder Is Unreachable, Start Here

This is the day-one document for a competent stranger. It does not repeat the other seventeen documents; it sequences them, inventories every system and script, and gives you one command that **proves** you can operate this platform before anyone has to trust you with production. The bus factor of Pulse is one person. This file, and the drill below, are the technical share of that problem — the irreducible human share is named at the bottom, not hidden.

## Hour one — prove the machine in front of you works

```bash
cd backend && npm ci && npm test        # 1,313 checks on an embedded Postgres; no network, no secrets
npm run continuity:drill                # install → first admin → backup → wipe → RESTORE → chain verified
npm run continuity:check                # this document is complete, or CI fails
```

If all three pass, you hold a machine that can build, verify, and **recover** Pulse. The drill is the point: *a restore you have never run is not a backup* — so the restore rehearsal is a command, executable by anyone, exercised in CI on every push. The suite's own dependency (`@electric-sql/pglite`) is declared in `devDependencies` — it once lived only as a workaround line inside CI, which is exactly the kind of trapped knowledge this file exists to eliminate.

## Day one — reading order (why each, in sequence)

1. **README.md** — what Pulse is, in one screen.
2. **VISION.md** then **PULSE-MASTERPLAN.md** — where it is going, and the complete build history with every decision and its reason. The masterplan is the canon; when any document disagrees with it, the masterplan wins.
3. **ARCHITECTURE.md** — rails, engines, state machines, the decision log, and the table census that CI enforces (`npm run docs:census`, `npm run docs:check`).
4. **ADMIN-GUIDE.md** — every operator-facing behaviour, written for the client's admin; it is also your feature map.
5. **DEPLOYMENT.md** and **INSTALLER.md** — how an instance reaches production and how a new client instance is stood up.
6. **DESIGN.md** (Nabd) and **BAYAN.md** — how Pulse looks and how it speaks Arabic; `npm run lint:ar` fails the build on register drift.
7. The briefs, when you touch their territory: **PERSONA-AUDIT.md**, **RED-TEAM-BRIEF.md**, **CMO** material inside the masterplan, **OSINT-BRIEF.md**, **WAVE-3-BRIEF.md**, **W2A-EXECUTION-BRIEF.md**, **SOCIAL-API-BRIEF.md**, **MMM-STAGE2-BRIEF.md**, **SOC2-BRIEF.md**.
8. **CONTINUITY.md** — this file; `npm run continuity:check` asserts it references every script and every root document, so neither can quietly outgrow it.

## Systems & access register — honest, no secrets in this file

| System | What it is | Where credentials live | Who has access today |
|---|---|---|---|
| Supabase | Production Postgres, project `gtybfwjghpoaurupbamq` (eu-west-1) | Supabase account + `DATABASE_URL` in Vercel env | **Founder only** |
| Vercel | Hosting + env vars (incl. `CRON_SECRET`, `PULSE_SECRET_KEY_V1`) | Vercel account | **Founder only** |
| Git host | Source of truth for this repo + CI | Repository owner account | **Founder only** |
| Anthropic API | AI rail + live search default provider | Key in Vercel env / instance settings (encrypted at rest, SEC·A) | **Founder only** |
| Meta / TikTok / Google | Connector apps (publish, spend sync) | App dashboards; tokens stored encrypted per instance | **Founder only** |
| SMTP / mail | Digest + notification mail | Instance settings (encrypted) | **Founder only** |
| Domain / DNS | Client-facing hostnames | Registrar account | **Founder only** |

Every **Founder only** row above is the risk. Rotations: `npm run secrets:audit` shows what is encrypted where; `npm run secrets:rotate` re-keys; `npm run secrets:migrate` moves legacy plaintext under encryption. The `PULSE_SECRET_KEY_V1` environment variable is the master key — losing it orphans encrypted secrets; it lives only in the deployment environment, never in the repo.

## Operations index — every command, one line each

`npm run dev` local API with reload · `npm start` production API · `npm run db:apply` apply schema (`supabase/setup.sql` fresh, `supabase/migrations/APPLY-LATEST.sql` on existing) · `npm run seed` generic starter data · `npm run seed:demo` full demo instance (113/113 tables covered) · `npm test` the whole regression · `npm run docs:census` regenerate the table census · `npm run docs:check` fail if docs and schema diverge · `npm run lint:ar` Bayan Arabic lint · `npm run secrets:migrate` / `secrets:audit` / `secrets:rotate` as above · `npm run soc2:evidence` dated audit-evidence pack · `npm run continuity:drill` the recovery rehearsal · `npm run continuity:check` this file's completeness gate.

## Incident quick cards

**Instance down.** `GET /api/health` (honest, no liveness stub). Vercel logs → `error_log` via **System** page (fault rows carry shape + hash, never payloads). Redeploy last green commit.

**Bad deploy.** Vercel instant rollback to the previous deployment; the database is migration-forward (`APPLY-LATEST.sql` is additive), so rolling code back is safe.

**Data loss / corruption.** **Settings → Backup** (or `GET /api/export/backup`) is a full JSON of client data; `POST /api/export/restore` reinserts in the FK-safe `RESTORE_ORDER`. Users, roles, and the governance trail are deliberately never restored — identity and history are not client data to overwrite. You rehearsed this in hour one; do exactly what the drill does.

**Identity-provider outage (SSO required, nobody can sign in).** One audited **break-glass** administrator (`users.breakGlass`) can still use password sign-in; every such use writes `auth_events(method='break_glass')` and an `auth.break_glass` audit entry — loud by design. Confirm the account exists *before* you need it: Users page, break-glass badge.

**Suspected tampering.** **System → Verify chain** (or `GET /api/security/audit-verify`): the governance trail is a hash chain behind an append-only trigger; a break names its exact row. `GET /api/security/access-review` for the live account audit.

**Client offboarding / data requests.** Erasure anonymizes rather than deletes (board packs survive), export bundles the subject's rows — both under `/api/erasure`, documented in ADMIN-GUIDE.

## The irreducible item

No script grants a second human access to the register above. Until a named second person holds credentials to those systems and has run the drill on their own machine, the bus factor remains one — and the SOC 2 evidence pack (`npm run soc2:evidence`) will keep printing it as the top open organizational risk on every generation. That line is removed by an appointment, not a commit.
