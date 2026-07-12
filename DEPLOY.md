# Deploying Synthica

Three deployable pieces:

| Piece | Folder | What it is | Host |
|-------|--------|------------|------|

| Backend API | `backend/` | Node + Express | Render / Railway / Fly.io |
| Dashboards | repo root (`src/`, builds to `docs/`) | React + Vite SPA | GitHub Pages (main → /docs) |

## GitHub Pages (dashboards)

1. Build with the deployed backend URL baked in, then commit the output:

   ```bash
   VITE_API_BASE=https://<your-backend-host> npm run build
   git add docs && git commit -m "Deploy dashboards"
   git push
   ```

2. On GitHub: **Settings → Pages → Deploy from a branch → `main` / `docs`**.
3. The app serves at `https://synthica-org.github.io/dashboard/` (the build's
   `/dashboard/` base + SPA `404.html` fallback are handled by `npm run build`;
   set `VITE_API_BASE` in the backend's `CORS_ORIGINS` too).
   Custom domain? Build with `VITE_BASE=/`.

The two frontends talk to the backend, so **deploy the backend first**, then point the frontends at its URL.

---

## A. Run it all locally

```bash
npm run install:all   # first time only
npm run dev           # backend :4000 · dashboards :5173
npm --prefix backend run test:workflow   # exercises every pipeline path
```

Log in with the demo accounts in `README.md` (password `demo1234`).

---

## B. Deploy to the cloud

### 1) Backend → Render

- **New → Blueprint** → pick the repo (reads [`render.yaml`](render.yaml)). The blueprint provisions the web service **plus a managed Postgres database** wired up via `DATABASE_URL`, so data persists across restarts and deploys out of the box. On first boot the backend seeds the empty database automatically — no separate seeding step.
- Or manually: New → Web Service with **Root Directory `backend`**, build `npm install`, start `node server.js`; then New → PostgreSQL, and set `DATA_PROVIDER=postgres` + `DATABASE_URL` (the database's **Internal** connection string) on the service.
- A [`Dockerfile`](backend/Dockerfile) is included for container hosts.
- Set the remaining env vars from the [table below](#environment-variables).
- Verify: `https://<backend>/api/health` → `{ "ok": true }`.
- Free tier sleeps after ~15 min idle (first request after wakes in ~30s); free Postgres instances expire after a trial period — upgrade the database plan for real production.

### 2) Dashboards → Vercel

- **New Project** → root directory (uses [`vercel.json`](vercel.json), output `docs/`).
- Env: `VITE_API_BASE` = backend URL (no trailing slash); `VITE_GOOGLE_CLIENT_ID` if using Google.
- Redeploy after changing env vars (Vite inlines them at build time).

### 3) Marketing site → Vercel

- To pull live journal/profile data, add to the `<head>` of `journal-archive.html`, `article.html`, `profile.html` **before** `journal-data.js`:
  ```html
  <script>window.SYNTHICA_API_BASE = 'https://<backend>';</script>
  ```
  Without it those pages use built-in sample data.

> Tip: put the site on the apex domain and the dashboards on a subdomain (e.g. `app.synthica.org`) under each Vercel project's **Settings → Domains**.

---

## Adding Google Sign-In (OAuth)

1. **Google Cloud Console** (https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → fill app name, support email, logo; add scopes `email`, `profile`, `openid`; add yourself as a test user (or Publish).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → **Web application**.
   - **Authorized JavaScript origins:** your dashboards URL(s), e.g.
     `https://app.synthica.org`, `https://synthica-dashboards.vercel.app`, and `http://localhost:5173` for local dev.
   - (No redirect URI needed — we use the Google Identity Services popup/one-tap, not a redirect flow.)
   - Copy the **Client ID** (looks like `…apps.googleusercontent.com`).
4. Set it in **two** places (same value):
   - Backend (Render → Environment): `GOOGLE_CLIENT_ID=…`
   - Dashboards (Vercel → Environment): `VITE_GOOGLE_CLIENT_ID=…` → **redeploy**.
5. Done. A "Continue with Google" button now appears on Login + Register. The backend verifies the Google ID token (audience/issuer/expiry) and links by email or creates a new researcher.

If the client id is unset, the button simply doesn't render — everything else works.

---

## Integrations (optional)

| Feature | How |
|---------|-----|
| **Discord queue alerts** | Director → Admin → Integrations → paste a channel webhook (Discord → Channel → Integrations → Webhooks → New). Or set `DISCORD_WEBHOOK_URL`. |
| **WhatsApp alerts** | Point `WHATSAPP_WEBHOOK_URL` (or Admin → Integrations) at a Twilio/Make/Zapier webhook that forwards `{text}` to WhatsApp. |
| **Author emails** | Set `RESEND_API_KEY` (https://resend.com) + `EMAIL_FROM`. Without it, decision emails are logged only. |
| **Weekly digest** | Emails approved researchers the open programs, project spots, and next week's deadlines. On an always-on instance set `ENABLE_DIGESTS=true` (sends Mondays 13:00 UTC). On free tiers that sleep, point an external cron (e.g. cron-job.org) at `POST /api/admin/digest/send` with a director token — or use the button on the Admin page. |
| **Per-paper share cards** | Built in: `GET /api/journal/publications/:id/share` serves per-paper OG tags + a 1200×630 card image for link unfurls. Share that URL (not the static article page) on socials. Set `SITE_URL` so it forwards readers to your marketing site's article page. |
| **File uploads** | Avatars, résumés, and paper PDFs can be uploaded; files are stored on local disk under `UPLOAD_DIR` (default `backend/uploads`) and served at `/uploads`. On ephemeral hosts (Render free tier) uploads are **lost on restart** — mount a persistent disk and set `UPLOAD_DIR` to it, or swap `backend/src/uploads.js` for S3/R2. Set `UPLOAD_PUBLIC_URL` if the backend is fronted by a CDN/proxy. |
| **Persistent data** | **Postgres (recommended)** — set `DATA_PROVIDER=postgres` + `DATABASE_URL`; the empty database is seeded automatically on first boot. Or Google Sheets — see [`docs/GOOGLE_SHEETS.md`](docs/GOOGLE_SHEETS.md): set `DATA_PROVIDER=sheets`, `SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, then `npm run seed:sheet`. |

---

## Environment variables

| Where | Variable | Required? | Example / notes |
|-------|----------|-----------|-----------------|
| backend | `PORT` | host-set | `4000` |
| backend | `AUTH_SECRET` | **yes (prod)** | long random string; signs session tokens |
| backend | `NODE_ENV` | prod | set to `production` (backend won't boot without AUTH_SECRET) |
| backend | `CORS_ORIGINS` | **yes (prod)** | comma-separated allowed origins, e.g. `https://app.synthica.org` |
| backend | `FRONTEND_URL` | for emails | dashboards base URL (verify/reset links) |
| backend | `SITE_URL` | optional | marketing site base URL for paper share pages (default `https://www.synthica.org`) |
| backend | `UPLOAD_DIR` | optional | where uploaded files are stored (default `backend/uploads`); point at a persistent disk in prod |
| backend | `UPLOAD_PUBLIC_URL` | optional | public base URL for served uploads if behind a CDN/proxy |
| backend | `EMAIL_BRAND` | optional | name shown in transactional emails (default `Synthica`) |
| backend | `ENABLE_DIGESTS` | optional | `true` to send the weekly researcher digest from this instance (needs always-on) |
| backend | `GOOGLE_CLIENT_ID` | for Google login | `…apps.googleusercontent.com` |
| backend | `RESEND_API_KEY` | optional | author decision emails |
| backend | `EMAIL_FROM` | optional | `Synthica <noreply@synthica.org>` |
| backend | `DISCORD_WEBHOOK_URL` | optional | queue notifications |
| backend | `WHATSAPP_WEBHOOK_URL` | optional | queue notifications (relay) |
| backend | `DATA_PROVIDER` | **yes (prod)** | `memory` (default), `postgres`, or `sheets`. Memory loses ALL data on restart (the backend warns loudly in prod) |
| backend | `DATABASE_URL` | if postgres | Postgres connection string (Render: the database's Internal URL) |
| backend | `PGSSLMODE` | optional | override Postgres SSL autodetection: `disable` or `require` |
| backend | `SHEETS_SPREADSHEET_ID` | if sheets | spreadsheet id from URL |
| backend | `GOOGLE_SERVICE_ACCOUNT_JSON` | if sheets | service-account JSON (inline) |
| backend | `ALLOW_DEMO_LOGINS` | leave unset | in production the shared demo password (`demo1234`) is refused at login; set `true` only on a staging demo |
| backend | `ADMIN_EMAIL` | **strongly recommended (prod)** | guaranteed owner login; this account is created/password-reset as a platform admin on every boot |
| backend | `ADMIN_PASSWORD` | with `ADMIN_EMAIL` | the password for that account (use a long random string) |
| backend | `DEMO_ACCOUNTS` | optional | create demo logins on boot (works on an already-seeded DB; idempotent). One per line or `;`-separated, fields split by `\|`: `email\|password\|level[\|Name]` where level ∈ `lead\|associate\|chapter\|independent`. Pre-approved + onboarded. Example: `leadx@synthica.org\|S0me-Pass\|lead\|Lead Researcher` |
| dashboards (build) | `VITE_API_BASE` | **yes** | `https://<backend>` (no trailing slash) |
| dashboards (build) | `VITE_GOOGLE_CLIENT_ID` | for Google login | same client id |
| website (inline) | `window.SYNTHICA_API_BASE` | recommended | `https://<backend>` — powers the live impact counters, featured papers, and the mentor directory on the marketing site |
| website (inline) | `window.SYNTHICA_APP_URL` | recommended | dashboards URL (default `https://app.synthica.org`) — where the "Get involved" funnel sends people |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Production checklist

- [ ] `AUTH_SECRET` set (long & random) — the backend refuses to boot in prod without it
- [ ] `NODE_ENV=production` on the backend (enables the demo-password block + config guards)
- [ ] `CORS_ORIGINS` set to your real frontend origins
- [ ] `DATA_PROVIDER=postgres` + `DATABASE_URL` (the blueprint sets this up; first boot auto-seeds) — or `sheets` with its vars + `npm run seed:sheet` once
- [ ] **Owner login set**: production refuses the shared demo password, so a fresh deploy has **no usable account**. Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` — on every boot that account is created (or password-reset) as a platform admin so you can always sign in. This is the recommended way in.
- [ ] **Staff accounts secured**: change the passwords for the seeded `director`/`auditor` (all seeds share `demo1234`, which prod refuses at login). Sign in via the `ADMIN_EMAIL` account above, then set real passwords / promote real staff, and enable 2FA from Account
- [ ] **At least one auditor/admin can sign in** — new sign-ups are gated behind role assignment, so an empty staff bench means nobody ever gets in
- [ ] `VITE_API_BASE` set on dashboards; `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID` set in both places (if using Google sign-in)
- [ ] `RESEND_API_KEY` + `EMAIL_FROM` set (role-approval welcome emails, verification, decisions; logged-only without it)
- [ ] Backend `npm run test:workflow` passes
- [ ] Backend on a paid/always-on instance (no cold starts)
- [ ] Real assets swapped in (team photos, OG image, favicon)
- [ ] Tested on mobile down to ~320px

### How new members get in (so you can verify the flow)
1. Sign-up (password or Google) creates an **unapproved** account with no role — they see a pending screen and can add a résumé + describe their experience.
2. An **auditor/director/admin** reviews the Onboarding queue (Admin page), sees the scores + written experience + suggested role, and approves with a role.
3. The member gets a welcome email + in-app congrats and lands in their dashboard.

### Community portal features (no extra config)
- **Research Groups, per-project roles, suggested people, Programs, Competitions board,
  platform-wide events/workshops, and referral tracking** all run on the existing
  store/provider layer. On Postgres (the default) nothing to do; on Sheets the new
  `Groups` and `Competitions` tabs (and added columns) are created automatically on the
  next write — existing spreadsheets keep working.
- **Referrals**: members share `<app>/register?ref=CODE`; signups are credited to the
  referrer and surfaced on the Admin → Referral leaderboard (build rewards on top later).

### Already handled (no action needed)
- CORS locking via `CORS_ORIGINS`; security headers; per-IP auth rate limiting
- Email verification + password reset flows; scrypt password hashing; optional TOTP 2FA
- Append-only audit log (Admin page) + one-click JSON backup export
- Demo-credential lockout in production (`ALLOW_DEMO_LOGINS` opt-out)

### Worth doing as you grow
- **Paid database plan** — free Render Postgres expires after a trial period; upgrade the instance to keep your data long-term. (Postgres is already the default provider in `render.yaml`; Sheets remains available via `DATA_PROVIDER=sheets`.)
- **httpOnly cookie sessions** if you want XSS-proof tokens (currently Bearer in localStorage).
- **Monitoring/alerts** (uptime, error tracking) and a shared rate-limit store (Redis) if you run multiple backend instances.
