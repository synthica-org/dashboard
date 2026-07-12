# Synthica Platform

Monorepo skeleton for [Synthica](https://www.synthica.org) — research made approachable
for high school students. This repo covers the four active development tracks.

> **Status: skeleton.** The marketing site is brand-complete; the dashboards and backend
> are functional end-to-end against an **in-memory mock** of what will eventually be
> Google Sheets / Apps Script and the journal database. The mock mirrors the real data
> shapes so the storage layer can be swapped without touching the UI or route layer.

## Tracks & layout

| Track | Owner(s) | Location | Stack |
|-------|----------|----------|-------|
| 1. Website UI/UX | Rudransh Shukla, Henry Russell | [`website/`](website/) | Static HTML + vanilla JS |
| 2. Journal database / DOI | Hannan Ali | [`backend/`](backend/) (`/api/journal`) | Node + Express |
| 3. Journal editor dashboard | Arjun Vijay Prakash | [`dashboards/`](dashboards/) (`/editor`) + backend | React + Vite |
| 4. Researcher dashboard | Ankush Dutta, Michael Omijie | [`dashboards/`](dashboards/) (`/researcher`) + backend | React + Vite |

```
index.html    Vite entry for the dashboards SPA (source lives in src/)
src/          React SPA: editor workflow dashboard + researcher dashboard, shared brand UI
backend/      Express API: journal publications/DOI registry + data layer for both dashboards
docs/         Committed production build — GitHub Pages serves main → /docs
shared/       Design system CSS + icon set shared by the app
```

## Quick start

Run everything with one command from the repo root:

```bash
npm run install:all   # installs root + backend deps (first time only)
npm run dev           # backend :4000 · dashboards :5173
```

Or start each piece on its own:

```bash
# 1. Backend API (http://localhost:4000)
cd backend && npm install && npm start

# 2. Dashboards (http://localhost:5173, proxies /api to the backend)
npm install && npm run dev:app
```

To deploy for shareable testing (Render + Vercel), see **[DEPLOY.md](DEPLOY.md)**.

### Demo logins (password: `demo1234`)

| Username | Role |
|----------|------|
| `rina.bio`, `marco.bio` | Reviews editors (Biology) |
| `helen.bio` | Senior editor (Biology) |
| `jonah.bio` | Associate editor (Biology) |
| `chief` | Editor-in-Chief |
| `director` | Director |
| `sam` | Lead researcher |
| `jordan` | Associate researcher |
| `taylor` | Chapter leader |
| `robin` | Independent researcher |

## Track 3 — review workflow

A paper flows through the pipeline below. **Every** decision (approve *or* decline)
posts an email task to the Director's desk; declines short-circuit the rest of the pipeline.

```
Submission (subject classification + Drive PDF link)
   └─ assigned to 2 Reviews editors in its category (load-balanced)
        ├─ both approve ──▶ Senior editor (screening)
        │                      └─ approve ──▶ Associate editor (2 revision rounds w/ author)
        │                                        └─ done ──▶ Senior editor (final check)
        │                                                      └─ approve ──▶ Editor-in-Chief
        │                                                                       └─ approve ──▶ Director: Papers to publish ──▶ DOI
        └─ not both approve ──▶ declined
```

- **Load balancing:** new papers go to the least-loaded eligible editors in the category.
- **Reviews editors** give feedback (required) + a recommendation (required only on approve),
  see their co-reviewer's decision, and a paper only advances when both approve.
- **Senior / Associate / Chief** see the accumulated reviewer recommendations + prior feedback;
  Associate and Senior-final get the author's email to make contact.
- **Director desk:** *Papers to email* (every decision, with the state it reached) and
  *Papers to publish* (finished papers → assign DOI into the Track 2 registry).

The whole pipeline is exercised in one pass — see the integration test snippet in
`backend/` route handlers and the end-to-end flow described above.

## Track 4 — researcher portal (community)

Beyond projects and the journal, the researcher dashboard is a full community portal:

- **Projects** — tasks, roster, ideas, and **per-member roles** (e.g. "Head of Data
  Collection") that the lead assigns and that auto-appear on each member's profile.
- **Suggested people** — leads get teammates ranked by shared interests and invite them
  in one click.
- **Research Groups** — interest hubs run by a lead that bundle several projects, a member
  roster, open **positions**, and shared links (a "guild" of projects). Group membership
  shows on profiles.
- **Programs** — structured cohorts (apply → milestones), reviewed by auditors.
- **Competitions board** — opportunities posted by staff (senior editors+).
- **Events** — project, group, chapter, and **platform-wide workshops** (staff) all land on
  each member's Calendar.
- **Referrals** — every member gets a referral link (`/register?ref=CODE`); signups are
  credited to the referrer, with an admin leaderboard for future rewards.
- **Certificates** — role certificates (Associate/Independent/Lead) generated in-app with a
  public verification code; profiles carry rich data (affiliations, socials, research group).

These are all served by the same store/provider layer — no schema migration needed on
Postgres (the default), and the Sheets provider auto-creates the `Groups`/`Competitions`
tabs on first write.

## Swapping the mock for Google Sheets

The store interface in [`backend/src/store.js`](backend/src/store.js) is the only thing
that touches data. Re-implement that same interface on top of the Sheets API / Apps Script
(submissions sheet, editor roster sheet, login sheet) and neither the routes nor the React
app need to change. Plaintext demo passwords in `seed.js` must become hashes in the real
login sheet.

## Brand

All UI follows the Synthica brand: Garet typeface, sky-blue gradient (`#2589ed → #99ccff`),
brand blue `#78b4fb` for interactive elements, gold `#FFD700` for emphasis, glassmorphism
surfaces, and rounded cards. Tokens live in `shared/design-system.css` (`:root`) and `src/styles.css` (`:root`).
