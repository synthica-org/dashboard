# Synthica Journal & Preprint — Architecture Plan

> **Status: PLAN ONLY — nothing here is built yet.** This is the design to review
> before code. Scoped so it does **not** collide with the in-flight pipeline
> rework: nothing below touches the editorial review state machine
> (`submissions` + stages) — it builds on top of the **published output**
> (`publications`) and adds a parallel **preprint** track.

Inspired by the structure (not the styling) of Nature and IEEE Xplore: a strong
**article hero**, browsable **volumes/issues**, and a deep **archive**.

---

## 1. Two products, one backend

| Product | What it is | Audience | Identifier |
|---|---|---|---|
| **Synthica Preprints** | Author-posted, *not* peer-reviewed. Instant, versioned, citable. | Anyone browsing; authors self-post from the dashboard. | Internal **Synthica ID** (e.g. `SYN-2026-0421`), no DOI |
| **Synthica Journal** | Peer-reviewed, editor-published output of the existing pipeline. | Public readers, indexers. | **DOI** (Crossref) |

A paper's lifecycle: *(optional)* **preprint** → submit to pipeline → review →
**published in journal (DOI)**. The journal article links back to its preprint
version; the preprint shows a "Now published" banner with the DOI.

Both render through the same components and live under one backend, distinguished
by a `track` field (`'preprint' | 'journal'`).

---

## 2. Where this fits the current code (today's reality)

- `backend/src/store.js`
  - `submissions` = the **review pipeline** (stages). **Out of scope** — your rework owns it.
  - `publications` = **published journal output**. The article model already has:
    `doi, title, articleType, authors[], category, abstract, keywords, received/accepted/publishedAt, volume, issue, pages, pdfUrl, license, openAccess, sections[], metrics, citationCount`.
  - `publishToJournal()` mints an internal DOI `10.55555/synthica.YYYY.NNNN` and calls `registerDoi()`.
  - `backend/src/doi.js` = a **Crossref deposit stub** (env `CROSSREF_DEPOSIT_URL/USER/PASS`), currently posts a non-conformant 3-field XML. Needs the real schema (§7).
- Public site (`website/`): `journal.html`, `journal-archive.html`, `article.html`, `journal-data.js`, `editorial-board.html` already exist — the redesign targets these.
- Dashboards (`dashboards/src/`): `pages/researcher/MyJournal.jsx` (author submissions), `pages/Archive.jsx`.

**Implication:** the journal track is ~70% modeled already. The new build is
(a) the **preprint track**, (b) the **issue/volume + archive** browse, and
(c) the **article hero** redesign + a real **Crossref** deposit.

---

## 3. Information architecture (URLs & pages)

```
PUBLIC (website/)
  /journal                      Journal home — hero + current issue + sections
  /journal/volumes              All volumes → issues grid (IEEE-style)
  /journal/vol/:v/issue/:i      One issue: table of contents
  /journal/article/:doi         ARTICLE HERO page (the Nature layout, §4)
  /preprints                    Preprint server home — latest + search
  /preprints/:synId             Preprint hero (version history, "now published")
  /archive                      Unified search/filter across journal + preprints
  /editorial-board              (exists)

DASHBOARD (dashboards/)
  My Journal     submit to pipeline, track status, revisions (exists)
  My Preprints   post/replace a preprint version, see views (NEW)
  Admin/Editor   "Publish to journal" → mint DOI → trigger Crossref deposit (exists, extend)
```

---

## 4. Article hero page (the structure you liked)

Two-column on desktop, single column on mobile. **Left = content, right = a
sticky action/metadata rail** — the Nature pattern.

```
┌───────────────────────────────────────────────────────────┐
│ breadcrumb:  Synthica › Journal › Biology › Article        │
│                                                            │
│ ARTICLE TYPE · Open Access        published 17 Jun 2026    │  ← eyebrow row
│                                                            │
│  Big Serif Title of the Paper Goes Here                    │  ← hero <h1>
│  Spanning two or three lines like Nature                   │
│                                                            │
│  Authors: A. Lin, R. Mehta, J. Park   ·  ✓ ORCID          │
│  Affiliations · Corresponding author                       │
│                                                            │
│  Abstract / lede paragraph in slightly larger type,        │
│  2–4 sentences, exactly like the Nature briefing.          │
│                                                            │
│  [ PDF ]  [ Cite ▾ ]  [ Share ▾ ]  metrics: 1.2k views    │
├──────────────────────────────────────┬─────────────────────┤
│  Sections (rendered from sections[])  │  ░ STICKY RAIL ░    │
│   Introduction                        │  • Download PDF      │
│   Methods                             │  • DOI: 10.55555/…   │
│   Results …                           │  • Cite (BibTeX/RIS) │
│  References                           │  • Volume/Issue/Pages│
│                                       │  • License (CC BY)   │
│                                       │  • Metrics           │
│                                       │  • Related articles  │
└──────────────────────────────────────┴─────────────────────┘
```

- Reusable as `<ArticleHero>` for **both** journal articles and preprints; the
  rail swaps "DOI" for "Synthica ID + version history" on preprints.
- Build the markup-only version first against existing `publications` data
  (the "frontend-only" option) — zero backend risk.
- Add **machine metadata** in `<head>`: Highwire/Dublin Core `<meta>` tags
  (`citation_title`, `citation_author`, `citation_doi`, `citation_pdf_url`, …)
  so Google Scholar indexes it. Cheap, high-value, no Crossref needed.

---

## 5. Journal browse: volumes, issues, archive (Nature/IEEE)

- **Journal home:** hero featuring the latest/landmark article, then "Current
  issue" table of contents, then "Browse by subject."
- **Volumes → Issues:** `volume`/`issue` already exist on publications. Group
  `publications` by `volume` then `issue`; render an issue as a classic ToC
  (article type, title, authors, pages, PDF). IEEE's "browse by volume/issue"
  pattern.
- **Archive:** one search box + facets (year, subject, type, journal vs
  preprint, open-access). Backed by a single `GET /api/journal/search` over both
  tracks. Reuse the existing `searchAll`/publication list plumbing.

---

## 6. Backend data model (additions, not rewrites)

Add to the **publication** object (and a sibling **preprint** record), keeping
everything backward-compatible:

| Field | Track | Purpose |
|---|---|---|
| `track` | both | `'preprint' \| 'journal'` |
| `synId` | both | Stable internal ID, e.g. `SYN-2026-0421` (preprint indexing) |
| `versions[]` | preprint | `{ v, pdfUrl, postedAt, note }` — preprints are versioned |
| `linkedDoi` | preprint | set when the preprint is later published |
| `preprintOf` / `hasPreprint` | journal | cross-link to the preprint |
| `references[]` | journal | `{ doi?, unstructured }` — needed for Crossref `citation_list` + "References" UI |
| `funding[]`, `orcids{}` | journal | recommended Crossref metadata |
| `crossref` | journal | `{ status: 'none'\|'pending'\|'deposited'\|'failed', batchId, depositedAt, error }` |

**Storage of PDFs/assets:** today `pdfUrl` is an external link (Drive). For real
hosting, store under the existing uploads layer (`backend/src/uploads.js`,
`/uploads`) **or** S3/R2 in prod (already flagged in `DEPLOY.md`). Plan: a
`paperFiles` concept `{ paperId, kind: 'manuscript'|'supplement'|'figure', url }`.
Keep using JSONB collections via the Postgres provider — no schema migration tool
needed (the provider stores each collection as one JSONB row).

**Preprint indexing system (own IDs):** mint `SYN-YYYY-NNNN` sequentially per
year at post time (mirror of `nextSynthicaDoi()`), guaranteed unique, never
reused across versions (versions bump `v`, not the ID). This is the preprint
"accession number" — citable immediately, no Crossref.

---

## 7. DOI / Crossref — REQUIREMENTS (documented, not built)

**Decision recorded: plan only this pass.** Here's exactly what a real
integration needs, mapped to our model, so we can flip it on later.

### Prerequisites (org/account — not code)
- **Crossref membership** + annual fee, and **per-DOI deposit fees**. Required to
  deposit; you can't self-assign resolvable DOIs without it.
- A **registered DOI prefix** (e.g. `10.xxxxx`). **Today's `10.55555/…` is a
  placeholder and will not resolve** — swap it for the assigned prefix.
- Deposit **credentials** (`login_id` / `login_passwd`), often `role/user`.

### Endpoints & transport
- **Production:** `https://doi.crossref.org/servlet/deposit`
- **Sandbox/test:** `https://test.crossref.org/servlet/deposit` (requires emailing
  support@crossref.org to provision the test account first).
- **HTTPS POST**, multipart form-data, params: `operation=doMDUpload`,
  `login_id`, `login_passwd`, and the XML as the **`fname`** file part.
- UTF-8 only; special chars as numeric entities (`&#352;`). ≤10 MB/file.
- Deposit is **asynchronous**: the POST returns a submission ID; the actual
  success/failure arrives later (poll the submission queue or receive an email).
  So `crossref.status` must model `pending → deposited/failed`.

### XML schema
- Current **metadata deposit schema 5.3.1** (`crossref5.3.1.xsd`). Structure:
  `doi_batch › head + body › journal › journal_metadata + journal_issue + journal_article`.

### Required elements for a journal article (map to our data)
| Crossref element | Required? | Our source |
|---|---|---|
| `doi_batch_id`, `timestamp` (head) | ✅ | generate per deposit |
| `depositor` (name + email), `registrant` | ✅ | Synthica org constants |
| `journal_metadata › full_title` + **`issn`** (or journal-level DOI+URL) | ✅ | **need to register an ISSN** (or use title-DOI) |
| `journal_issue › publication_date (year)`, `volume`, `issue` | ✅ (year) | `publishedAt`, `volume`, `issue` |
| `journal_article › titles/title` | ✅ | `title` |
| `journal_article › publication_date (year)` | ✅ | `publishedAt` |
| `doi_data › doi` + `resource` (URL) | ✅ | `doi` + canonical article URL |
| `contributors › person_name` (+ **ORCID**) | ⭐ recommended | `authors[]`, `orcids{}` |
| `publication_date` month/day, `pages` (first/last) | ⭐ | `publishedAt`, `pages` |
| `citation_list` | ⭐ | `references[]` (new field, §6) |
| `program/license_ref` (license) | ⭐ | `license` (CC BY 4.0) |
| JATS `abstract` | ⭐ | `abstract` |

**Gap to close before going live:** register an **ISSN** for the journal (free
via the national ISSN centre) *or* deposit a title-level DOI — Crossref requires
one of the two at the journal level.

### Build plan (later, behind a flag)
1. `crossrefDepositXml(pub)` → conformant 5.3.1 XML (replaces the stub in `doi.js`).
2. POST to **sandbox**, validate, fix until accepted.
3. Persist `crossref.status`; add an Admin "Deposit / retry" button + status pill.
4. Flip `CROSSREF_DEPOSIT_URL` to production once the prefix + ISSN + membership are live.
- **Preprints get no Crossref DOI** (that's correct — preprints use the internal
  Synthica ID; a DOI is only minted on journal publication). Optionally later,
  preprints could get DOIs via Crossref's "posted_content" type — out of scope.

---

## 8. Phased roadmap (sequenced to avoid the pipeline rework)

| Phase | Scope | Collision risk |
|---|---|---|
| **0 (this doc)** | Plan + Crossref requirements | none |
| **1** | `<ArticleHero>` redesign (Nature structure) against existing `publications`; Scholar `<meta>` tags | **none** (read-only frontend) |
| **2** | Volumes/Issues + unified Archive browse | none (read-only) |
| **3** | Preprint track: model (`track`, `synId`, `versions[]`), post/replace UI, preprint hero | low (additive collections) |
| **4** | Cross-linking preprint ⇄ journal; "now published" banners | low |
| **5** | Real Crossref deposit (sandbox → prod), Admin status UI | isolated to `doi.js` + publish step |

Phases 1–2 are safe to start **now** while you rework the pipeline, because they
only read `publications`. Phase 5 waits on the org prerequisites (membership,
prefix, ISSN).

---

## 9. Decisions I need from you

1. **Journal identity for Crossref:** register an **ISSN**, or go title-level-DOI? (Blocks real deposits.)
2. **Real DOI prefix** — do you have/plan a Crossref membership + prefix, or stay internal-only for now?
3. **PDF hosting:** keep external links (Drive), or host via uploads/S3 so articles are self-contained?
4. **Preprint moderation:** anyone posts instantly, or a light pre-screen before a preprint goes public (matters for a minors-heavy platform)?
5. **Branding:** one journal, or multiple journals-by-subject (changes the volume/issue + ISSN model)?

---

### Sources (Crossref docs consulted)
- Direct deposit (XML): https://www.crossref.org/documentation/register-maintain-records/direct-deposit-xml/
- HTTPS POST endpoint + params: https://www.crossref.org/documentation/register-maintain-records/direct-deposit-xml/https-post/
- Required/recommended elements: https://www.crossref.org/documentation/schema-library/required-recommended-elements/
- Metadata deposit schema 5.3.1: https://www.crossref.org/documentation/schema-library/metadata-deposit-schema-5-3-1/
- Journals & articles markup guide: https://www.crossref.org/documentation/schema-library/markup-guide-record-types/journals-and-articles/
