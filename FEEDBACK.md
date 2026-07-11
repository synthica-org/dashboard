# Design Critique: Synthica Dashboard, Journal & Archive

Reviewed live against the running app (Vite dev build, seeded demo data) on desktop (1280px) and mobile (375px), in both light and dark themes, across three accounts: `testall` (all editor views), `rina.bio` (category reviews editor), and `maya` (researcher / member portal). Contrast figures below are measured WCAG ratios from computed styles, not eyeballed.

---

## Overall Impression

The product has a genuinely strong editorial identity — the serif-on-dark journal reads like a real publication, the review pipeline UI explains itself unusually well ("Your job at this stage", "STAGE 1 OF 5", "What happens next"), and the Resend-inspired monochrome dashboard is calm and coherent. The biggest opportunities are (1) a systemic light-mode contrast failure baked into one token alias, (2) the public journal being unnavigable on mobile, and (3) a handful of visibly broken surfaces (Director Desk stats, Admin warning banner) that undermine an otherwise polished impression.

---

## 1. Dashboard

### First impression

Signing in as a reviews editor lands you on a queue with clear guidance and status chips — good. Signing in as `testall` lands on *"Your account isn't a category editor, so you don't have a personal review queue"* — a negative dead-end as the default screen. The first thing a new admin reads is what they *can't* do.

### Usability

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Director Desk stats render broken**: "0emails to send / 0ready to publish / 0published" as unstyled stacked text. The `Stat` component in [DirectorDashboard.jsx:61](dashboards/src/pages/editor/DirectorDashboard.jsx:61) emits `dd-stat` / `dd-stat-num` / `dd-stats` classes that **have no CSS anywhere** in styles.css. | 🔴 Critical | Add the missing `.dd-stats` / `.dd-stat*` rules, or reuse the existing styled `Stat` from [ui.jsx:293](dashboards/src/components/ui.jsx:293) (`ui-stat`, styled at styles.css:2026). |
| **Admin email warning banner jumbles its sentence** — words render in misaligned columns ("Email delivery isn't configured (no `RESEND_API_KEY` )." fragments wrap independently). Cause: the whole multi-node sentence sits inside `.icon-label`, which is `inline-flex` ([styles.css:983](dashboards/src/styles.css:983)); each text node becomes its own flex item and wraps on its own. Same risk anywhere `IconLabel` wraps long copy ([Admin.jsx:46](dashboards/src/pages/editor/Admin.jsx:46)). | 🔴 Critical | Wrap the sentence in a single `<span>` inside the icon-label, or use `display: block` with the icon floated/positioned for long-copy alerts. |
| **Default landing for non-category editors is a dead end** ([EditorDashboard.jsx:142](dashboards/src/pages/editor/EditorDashboard.jsx:142) area). | 🟡 Moderate | Redirect accounts without a personal queue to their most useful view (Director Desk or Admin), or turn the message into a launcher: "You handle X — go to …". |
| **Admin is a ~5,900px mega-page**: analytics, people, bulk role assignment, projects, reports, member posts, competitions, published papers, integrations, backup, deployment guide — one scroll, no in-page navigation. Finding "Integrations" means scrolling past ~10 unrelated sections. | 🟡 Moderate | Add a sticky in-page anchor nav (or split into tabs: People / Content / System). The sidebar already proves the app has a nav pattern for this. |
| **Announcements block repeats at the top of every queue view**, pushing actual work (~600px) below the fold. The queue — the thing the editor came for — is the third block on their own queue page. | 🟡 Moderate | Collapse announcements to a one-line banner after first read (it already tracks a read count), or move them below the queue. |
| **Sidebar "Archive" silently exits the dashboard** onto the public site — same styling as internal items, no external-link cue, and the sidebar/topbar chrome vanishes. Researcher sidebar does the same with "Read Journal", "Preprints", "Archive". | 🟢 Minor | Add an external/↗ indicator to items that leave the shell, and group them under a "Public site" label. |
| **Destructive actions are inconsistently guarded**: "Suspend" on people cards and "Delete" on member posts are styled as ordinary secondary buttons, while "Delete" on published papers is correctly red-filled. | 🟡 Moderate | One rule: destructive = red treatment + confirm. Apply to Suspend and post Delete. |
| **Review modal has three separate action zones**: "Request revision from author" directly under the PDF, Approve/Reject mid-modal, comment Post at the bottom. The three verbs that decide a paper's fate aren't in one place. | 🟡 Moderate | Group Request-revision with Approve/Reject in a single sticky decision bar; keep discussion clearly separate. |
| **Broken PDF embed shows raw Google Drive error page** (white iframe, Google branding, locale-dependent text) inside the dark modal. | 🟢 Minor | You can't read the iframe's failure, but you can constrain the damage: smaller embed height + always-visible "Open paper PDF" link styled as the primary path (it exists, keep it first). |

### Visual hierarchy

- **What draws the eye first** (editor queue): the "Your job at this stage" panel — correct for first-time use, but it never yields to the queue itself on repeat visits.
- **Researcher home is onboarding-forever**: the hero + six "What you can do here" explainer cards occupy the entire first viewport; the live data (0 projects joined, 0 applications pending, 3 open listings, Research Hub listings) starts below the fold. For a returning member the dashboard shows instructions before status.
  → Put the stat row and Research Hub listings first; make the explainer cards a dismissible "Getting started" section.
- **Stat grids leave orphans**: Admin analytics renders 2+2+1 cards, researcher home 2+1 — the dangling card reads as a mistake. Use a 3-up (or auto-fit) grid.
- **Section heading systems mix on one page**: researcher home uses chip-style labels ("Research Hub", "My applications", "My Projects") *and* plain h2s ("What you can do here", "Projects you're on"). Pick one.

### Consistency

| Element | Issue | Recommendation |
|---------|-------|----------------|
| Naming | Breadcrumb says "Review queue / My queue", page title says "Editorial overview" — three names for one place. "Director desk / Director Desk" breadcrumbs itself with inconsistent casing. | One canonical name per view; breadcrumb tail should match the h1. |
| Naming | Researcher sidebar has **"Journal"** (which opens *Submit a paper*) and **"Read Journal"** (public site) as separate items. | Rename "Journal" → "Submit a paper" (or "My submissions"); rename "Read Journal" → "Synthica Journal ↗". |
| Iconography | Notification bell is a literal 🔔 emoji ([Bell.jsx:81, 94](dashboards/src/components/Bell.jsx:81)) in an otherwise monochrome SVG icon set — it's the only full-color glyph in the chrome, and it survived the recent emoji→icon sweep. | Swap for the line-icon bell from the existing icon set. |
| Copy | "1 likes · 0 comments" ([Admin.jsx:1095](dashboards/src/pages/editor/Admin.jsx:1095)) — no pluralization. | `n === 1 ? 'like' : 'likes'`. |
| Copy | "it only advances when you BOTH approve" — all-caps shouting in body copy. | Use bold ("you **both** approve"), matching the emphasis style used elsewhere. |
| Data display | Role dropdown shows raw enum `lead_researcher` to admins. | Map to display labels ("Lead Researcher") — labels already exist in the role picker. |
| Greeting | **"Welcome, Dr."** — first name is derived via `name.split(' ')[0]` ([researcher/Dashboard.jsx:21](dashboards/src/pages/researcher/Dashboard.jsx:21)), so "Dr. Maya Chen" greets as "Dr." Same pattern in AssociateHome and PendingApproval. | Strip common honorifics before splitting, or greet with the full name. |

### The onboarding wizard

Twelve progress segments is an intimidating first impression even though the steps are individually tiny (name → role → …). The one-question-per-screen pacing is pleasant; the meter is the problem — it front-loads the perceived cost. Group the meter into 3–4 labeled phases ("Profile · Interests · Role") rather than 12 anonymous dashes. "Skip" and "Decide later" escapes are well done.

---

## 2. Journal (public)

### First impression

Excellent. The serif masthead, stats row (2 articles · 1 volume · 2 subjects), Editor's Choice hero, and CC-BY/ISSN-pending footer read like a credible open-access journal, clearly distinct from the app chrome. This split identity (editorial serif vs. product Inter) is the strongest design decision in the codebase.

### Usability

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **The entire nav disappears on mobile.** `.jr-nav { display: none }` at ≤720px ([styles.css:2414](dashboards/src/styles.css:2414)) with **no hamburger or replacement** in [JournalChrome.jsx](dashboards/src/components/JournalChrome.jsx). On a phone, Home / Volumes & issues / Preprints / Archive / RSS are unreachable except by scrolling to the footer. | 🔴 Critical | Smallest fix: keep the nav visible as a horizontally scrollable row (`overflow-x: auto`, no wrap) — no JS, no hamburger needed at 5 links. |
| The same article appears three times on the home page (hero, "Current issue", "Latest articles"). Partly seed-data scarcity, but the sections don't dedupe the featured article. | 🟡 Moderate | Exclude the hero article from "Latest articles" (keep it in "Current issue", which is a factual listing). |
| "VOL. 1" eyebrow on each issue card sits directly under a "Volume 1" section heading — redundant at every card. | 🟢 Minor | Drop the eyebrow when cards are grouped under a volume heading. |

### Visual hierarchy

- Eye lands on the Editor's Choice hero → masthead → current issue. Correct order for a journal.
- The right rail (Competitions, Browse by subject, Most read, All volumes) is well-prioritized and doesn't compete with the article list.
- The "Publish your research with Synthica" banner before the footer is a good conversion placement and visually distinct.

---

## 3. Archive

### Usability & hierarchy

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| The archive replays the full home-page hero treatment for the featured article. On a page whose job is *finding a specific paper* (it leads with search + subject filter), a ~300px promotional hero between the search box and the results list works against the task. | 🟡 Moderate | Keep the archive utilitarian: search, filters, then a uniform scannable list. If you want a "Featured" marker, use a badge on the list row. |
| Search + "All subjects" filter is the right toolset, and the list rows are strong: type badge, Open Access tag, date, authors, one-line abstract, vol/issue/pages, mono DOI. This is the best list design in the app. | 🟢 (works well) | When the archive grows, add a visible result count next to the search box (the page header count "2 articles" won't update meaning as filters apply). |
| Mobile: inherits the missing-nav problem above (it *is* one of the pages stranded by it). | 🔴 (same fix) | Covered by the jr-nav fix. |

---

## 4. Accessibility (cross-cutting)

**Color contrast — one token alias causes a systemic light-mode failure.**

- The legacy alias `--body-alt` maps to `--fg-subtle` = **#a3a3a3** in light mode ([design-system.css:20, 62](shared/design-system.css:20)). The widely-used `.muted` class ([styles.css:535](dashboards/src/styles.css:535)) resolves to it.
- Measured: "What happens next" body copy = **2.31:1**, empty-state text ("Nothing submitted yet…") = **2.52:1** against their backgrounds. WCAG AA requires 4.5:1. This affects help text, empty states, and meta lines across the dashboard in light mode.
- Dark mode is mostly fine (tagline 7.85:1) but small meta text at `--fg-subtle` #737373 measures **4.18:1** — borderline fail at the 12–13px sizes it's used at.
- **Fix in one line**: alias `--body-alt: var(--fg-muted)` (#737373 light = 4.74:1 ✓) and reserve `--fg-subtle` for decorative/disabled elements only. Then bump dark `--fg-subtle` usage on meta text to `--fg-muted`.

**Gradient primary buttons**: "Submit to journal" and other `--btn-gradient` buttons put white 14px text on a gradient ending at #78b4fb — the light end falls well below 4.5:1 in light mode. Either darken the gradient's light stop or switch light-mode primaries to the flat `--accent` (#2589ed, which passes).

**Touch targets**: sidebar items, footer links, and card buttons are comfortably ≥40px. The onboarding progress dashes and the "+ tag…" selects are small but not primary paths. Adequate overall.

**Positives**: semantic labels on the login form, `aria-hidden` on decorative icons, visible focus ring on the onboarding input, real `<select>`/`<input type="date">` elements, keyboard palette (⌘K), and a proper accessibility tree (roles/labels came through cleanly in snapshot testing).

---

## What Works Well

- **The pipeline explains itself.** Stage meter ("STAGE 1 OF 5 → Next: Senior editor screens…"), status chips ("WAITING ON 2ND REVIEWER"), "Your job at this stage" checklists, and the "What happens next" panel under the submit form. This is rare and excellent — new editors and authors can't get lost.
- **Split identity**: serif editorial journal vs. monochrome Inter product chrome. Both are internally coherent.
- **Empty states carry next steps** ("Find one in the Hub →", "publish a paper below to add the first one") instead of dead text.
- **Honest metadata**: ISSN-pending badge, CC BY 4.0 in the footer, single-blind notice in the review modal, mono DOIs.
- **Login page**: demo-accounts disclosure, clear error banner, Google + email paths, archive escape hatch for non-members.

---

## Priority Recommendations

1. **Fix the `--body-alt` → `--fg-subtle` alias** ([design-system.css:62](shared/design-system.css:62)) — a one-line change that repairs light-mode readability across every dashboard page, plus audit dark-mode small meta text. Highest impact-to-effort ratio in this review.
2. **Restore mobile navigation on the public journal** ([styles.css:2414](dashboards/src/styles.css:2414)) — the journal and archive are the public face of the project and are currently one-page sites on phones. A scrollable nav row is a CSS-only fix.
3. **Repair the two visibly broken admin surfaces** — Director Desk's unstyled stats (missing `dd-stat` CSS) and the Admin warning banner's inline-flex text jumble. Both look like bugs to any user and erode trust in the editorial tooling.
4. **Reorder the researcher home**: live stats and Research Hub listings first, "What you can do here" as a dismissible getting-started block — the dashboard should show status before instructions. While in there, fix "Welcome, Dr." and the Journal/Read Journal label collision.
5. **Unify naming and destructive-action treatment in the editor app**: one canonical name per view (breadcrumb = h1), red + confirm for Suspend/Delete everywhere, display labels instead of raw enums.

---

*Method note: findings verified against the running app with computed-style contrast measurements; file/line references point at the responsible code. Two dev-only tweaks were made to enable the review: `dashboards/vite.config.js` now respects `PORT`, and `.claude/launch.json` gained `autoPort` for the dashboards config.*
