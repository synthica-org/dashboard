# Wiring the backend to Google Sheets

By default the backend runs on in-memory seed data (`DATA_PROVIDER=memory`).
Set `DATA_PROVIDER=sheets` to read/write a real Google Spreadsheet instead — so
submissions from the Google Form, the editor roster, the login table, and the
journal registry all live in Sheets, and dashboard changes persist.

The store interface is unchanged, so **nothing in the routes or the React app
changes** — only where the data comes from.

## How it fits together

```
Google Form ──(Apps Script)──▶ Submissions tab ┐
                                                ├─▶  backend (DATA_PROVIDER=sheets) ─▶ dashboards / journal site
Users · Publications · Projects · Listings tabs ┘         reads at startup, writes back on changes
```

- **`google-apps-script/onFormSubmit.gs`** copies each Form response into the
  `Submissions` tab (Track 3 intake).
- **`backend/src/providers/sheets.js`** loads every tab at startup and writes the
  mutable tabs (`Submissions`, `Publications`, `Applications`) back when the
  workflow changes them (debounced write-behind).
- **`backend/scripts/seed-sheet.js`** fills a fresh spreadsheet with demo data.

## 1. Create the spreadsheet + tabs

Create one Google Spreadsheet. It needs these tabs (the seed script creates them
for you), each with a header row matching `SCHEMAS` in `sheets.js`:

| Tab | Key columns |
|-----|-------------|
| `Users` | id, name, username, password, kind (`editor`/`researcher`), role, category, tags |
| `Submissions` | id, title, authorName, authorEmail, category, abstract, pdfUrl, submittedAt, stage, assignedReviewers, assignee, reviews, associateRounds, history |
| `Publications` | id, doi, title, articleType, authors, correspondingAuthor, category, abstract, keywords, receivedAt, acceptedAt, publishedAt, volume, issue, pages, pdfUrl, license, openAccess, sections, metrics, citationCount |
| `Projects` | id, title, category, description, leadId, members, announcements, tasks |
| `Listings` | id, title, category, spots, leadName, description |
| `Applications` | id, userId, userName, listingId, role, message, status, at |

Columns holding lists/objects (e.g. `authors`, `reviews`, `tasks`) are stored as
JSON strings in a single cell.

> The `password` column is plaintext here only for the demo. For anything real,
> store a hash and verify it in `backend/src/auth.js`.

## 2. Create a Google service account

1. In [Google Cloud Console](https://console.cloud.google.com/): create/select a
   project → **APIs & Services → Enable APIs** → enable **Google Sheets API**.
2. **Credentials → Create credentials → Service account.** Create a JSON key and
   download it.
3. Open your spreadsheet → **Share** → add the service account's `client_email`
   (from the JSON) with **Editor** access.

## 3. Configure the backend

Copy `backend/.env.example` to `backend/.env` and set:

```bash
DATA_PROVIDER=sheets
SHEETS_SPREADSHEET_ID=<id from the spreadsheet URL>
# either inline JSON…
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account", ...}
# …or a path to the key file:
# GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

Install deps (adds `googleapis`) and seed + run:

```bash
cd backend
npm install
npm run seed:sheet   # fills the spreadsheet with demo data (one time)
npm start            # now reads/writes Google Sheets
```

Log in with the same demo accounts (password `demo1234`). Approve a paper and
watch the `Submissions` / `Publications` tabs update.

## 4. Wire the Google Form (Track 3 intake)

1. Open the submission Form's linked spreadsheet → **Extensions → Apps Script**.
2. Paste `google-apps-script/onFormSubmit.gs`.
3. Edit `FIELD_MAP` so the question titles match your Form (title, name, email,
   subject classification, abstract, Drive link).
4. Run `setup` once (creates the trigger + `Submissions` tab), then optionally
   `importAllResponses` to backfill existing entries.

New submissions now land in the `Submissions` tab at the `review` stage; the
backend assigns each to two reviews editors in its category on its next load.

## Notes & limits

- **Write-behind:** mutations persist ~300ms after the change (batched). The
  backend keeps the working copy in memory and writes snapshots of the mutable
  tabs — fine for a journal's volume, not for high-frequency concurrent writes.
- **Single source of truth:** while the backend is running it owns the data; if
  you hand-edit a writable tab, restart (or `POST /api/dev/reset`) to reload.
- **Static journal site** can also read published articles from this backend —
  set `window.SYNTHICA_API_BASE` (see `DEPLOY.md`).
