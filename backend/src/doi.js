// DOI registration hook. Synthica mints an internal DOI on publish; if Crossref
// credentials are configured, we also (fire-and-forget) deposit the metadata so
// the DOI resolves publicly. Without credentials this is a no-op (internal DOI
// still works for the site/RSS).
//
// Env: CROSSREF_DEPOSIT_URL, CROSSREF_USER, CROSSREF_PASS (and a real registered
// DOI prefix). Crossref deposits are XML; this posts a minimal record. Treat as
// a starting point for a real integration.

const URL = process.env.CROSSREF_DEPOSIT_URL || '';
const USER = process.env.CROSSREF_USER || '';
const PASS = process.env.CROSSREF_PASS || '';

export const doiRegistrationEnabled = () => !!(URL && USER && PASS);

export function registerDoi(pub) {
  if (!doiRegistrationEnabled()) return; // internal DOI only
  const params = new URLSearchParams({ operation: 'doMDUpload', login_id: USER, login_passwd: PASS });
  // A full integration builds Crossref deposit XML; we send title/doi/url as a stub.
  const body = `<doi_batch><doi>${pub.doi}</doi><title>${pub.title}</title><resource>https://doi.org/${pub.doi}</resource></doi_batch>`;
  fetch(`${URL}?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body })
    .catch((e) => console.error('[doi] deposit failed:', e.message));
}

// --- shared journal-metadata helpers (citations, Scholar tags, Crossref) ----

const JOURNAL_TITLE = 'Synthica Journal';
// Read env at call time (not module load) so tests/hosts can set these late.
export const journalIssn = () => (process.env.JOURNAL_ISSN || '').trim();
export const journalUrl = () => (process.env.JOURNAL_URL || 'https://synthica-org.github.io/journal').replace(/\/$/, '');

const xmlEsc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Split a page range like "12-19" / "12–19" (or a single page "7") into parts.
export function parsePages(pages) {
  const m = String(pages || '').match(/^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/);
  if (m) return { first: m[1], last: m[2] };
  const single = String(pages || '').match(/^\s*(\d+)\s*$/);
  if (single) return { first: single[1], last: single[1] };
  return { first: '', last: '' };
}

// Stable, URL-safe slug for an article's landing page on the journal site
// (`${JOURNAL_URL}/articles/<slug>.html`).
export function articleSlug(pub) {
  return String(pub.title || pub.id || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '') || String(pub.id || 'article');
}

// "Given Surname" → { given, surname } (surname = last word; Crossref requires
// a surname, so a single-word name is treated as the surname).
export function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { given: '', surname: '' };
  if (parts.length === 1) return { given: '', surname: parts[0] };
  return { given: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

const pubYear = (pub) => String(pub.publishedAt || '').slice(0, 4) || String(new Date().getFullYear());

// BibTeX escapes for the characters that break fields; RIS/APA are plain text.
const bibEsc = (s) => String(s ?? '').replace(/[\\{}]/g, '').replace(/([&%$#_])/g, '\\$1');

// Ready-to-copy citations in the three formats article pages usually offer.
export function citationFormats(pub) {
  const year = pubYear(pub);
  const names = (pub.authors || []).map((a) => a.name).filter(Boolean);
  const { first, last } = parsePages(pub.pages);
  const doiUrl = pub.doi ? `https://doi.org/${pub.doi}` : '';
  const issn = journalIssn();

  const key = String(pub.doi || pub.id || 'synthica').split('/').pop().replace(/[^a-zA-Z0-9]+/g, '_');
  const bibtex = [
    `@article{${key},`,
    `  title = {${bibEsc(pub.title)}},`,
    `  author = {${names.map(bibEsc).join(' and ')}},`,
    `  journal = {${JOURNAL_TITLE}},`,
    `  year = {${year}},`,
    pub.volume ? `  volume = {${pub.volume}},` : null,
    pub.issue ? `  number = {${pub.issue}},` : null,
    first ? `  pages = {${first}${last && last !== first ? `--${last}` : ''}},` : null,
    pub.doi ? `  doi = {${pub.doi}},` : null,
    doiUrl ? `  url = {${doiUrl}},` : null,
    issn ? `  issn = {${issn}},` : null,
    '}',
  ].filter(Boolean).join('\n');

  const ris = [
    'TY  - JOUR',
    `TI  - ${pub.title || ''}`,
    ...names.map((n) => { const { given, surname } = splitName(n); return `AU  - ${surname}${given ? `, ${given}` : ''}`; }),
    `JO  - ${JOURNAL_TITLE}`,
    `PY  - ${year}`,
    pub.volume ? `VL  - ${pub.volume}` : null,
    pub.issue ? `IS  - ${pub.issue}` : null,
    first ? `SP  - ${first}` : null,
    last ? `EP  - ${last}` : null,
    pub.doi ? `DO  - ${pub.doi}` : null,
    doiUrl ? `UR  - ${doiUrl}` : null,
    issn ? `SN  - ${issn}` : null,
    'ER  - ',
  ].filter(Boolean).join('\n');

  // APA 7: Surname, F. M., & Surname, F. M. (Year). Title. Journal, Vol(Issue), pages. doi-url
  const apaName = (n) => {
    const { given, surname } = splitName(n);
    const initials = given.split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ');
    return initials ? `${surname}, ${initials}` : surname;
  };
  const apaAuthors = names.length > 1
    ? `${names.slice(0, -1).map(apaName).join(', ')}, & ${apaName(names[names.length - 1])}`
    : apaName(names[0] || '');
  const volPart = pub.volume ? `, ${pub.volume}${pub.issue ? `(${pub.issue})` : ''}` : '';
  const pagePart = first ? `, ${first}${last && last !== first ? `–${last}` : ''}` : '';
  const apa = `${apaAuthors} (${year}). ${pub.title}. ${JOURNAL_TITLE}${volPart}${pagePart}.${doiUrl ? ` ${doiUrl}` : ''}`;

  return { bibtex, ris, apa };
}

// The <month>/<day>/<year> children of a Crossref <publication_date>, indented
// with `pad`. Month/day are omitted when unknown; the year falls back (Crossref
// requires at least a year — e.g. for an issue that hasn't been closed yet).
function xmlDateParts(isoDate, fallbackYear, pad) {
  const [y, m, d] = String(isoDate || '').slice(0, 10).split('-');
  return `${m ? `${pad}<month>${xmlEsc(m)}</month>\n` : ''}${d ? `${pad}<day>${xmlEsc(d)}</day>\n` : ''}${pad}<year>${xmlEsc(y || fallbackYear)}</year>`;
}

// One <journal_article> record inside a Crossref deposit batch.
function crossrefArticleXml(pub) {
  const { first, last } = parsePages(pub.pages);
  const contributors = (pub.authors || [])
    .map((a, i) => {
      const { given, surname } = splitName(a.name);
      if (!surname) return null;
      return `        <person_name sequence="${i === 0 ? 'first' : 'additional'}" contributor_role="author">
${given ? `          <given_name>${xmlEsc(given)}</given_name>\n` : ''}          <surname>${xmlEsc(surname)}</surname>
        </person_name>`;
    })
    .filter(Boolean)
    .join('\n');
  // <contributors> is skipped entirely when no author has a usable surname —
  // Crossref rejects an empty contributors element.
  return `      <journal_article publication_type="full_text">
        <titles>
          <title>${xmlEsc(pub.title)}</title>
        </titles>
${contributors ? `        <contributors>
${contributors}
        </contributors>
` : ''}        <publication_date media_type="online">
${xmlDateParts(pub.publishedAt, pubYear(pub), '          ')}
        </publication_date>
${first ? `        <pages>
          <first_page>${xmlEsc(first)}</first_page>
${last && last !== first ? `          <last_page>${xmlEsc(last)}</last_page>\n` : ''}        </pages>
` : ''}        <ai:program name="AccessIndicators">
          <ai:license_ref applies_to="vor">https://creativecommons.org/licenses/by/4.0/</ai:license_ref>
        </ai:program>
        <doi_data>
          <doi>${xmlEsc(pub.doi)}</doi>
          <resource>${xmlEsc(`${journalUrl()}/articles/${articleSlug(pub)}.html`)}</resource>
        </doi_data>
      </journal_article>`;
}

// Crossref journal deposit XML (schema 5.3.1) for one issue: the batch head,
// journal + ISSN, the journal_issue, then a journal_article per publication.
// The Director downloads this and uploads it at doi.crossref.org.
export function crossrefBatchXml({ issue, articles }) {
  const ts = Date.now();
  const issn = journalIssn();
  const issueDate = `          <publication_date media_type="online">
${xmlDateParts(issue.publishedAt, String(issue.year || new Date().getUTCFullYear()), '            ')}
          </publication_date>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<doi_batch xmlns="http://www.crossref.org/schema/5.3.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:ai="http://www.crossref.org/AccessIndicators.xsd"
           version="5.3.1"
           xsi:schemaLocation="http://www.crossref.org/schema/5.3.1 https://www.crossref.org/schemas/crossref5.3.1.xsd">
  <head>
    <doi_batch_id>synthica-v${xmlEsc(issue.volume)}-i${xmlEsc(issue.issue)}-${ts}</doi_batch_id>
    <timestamp>${ts}</timestamp>
    <depositor>
      <depositor_name>Synthica</depositor_name>
      <email_address>journal@synthica.org</email_address>
    </depositor>
    <registrant>Synthica</registrant>
  </head>
  <body>
    <journal>
      <journal_metadata language="en">
        <full_title>${xmlEsc(JOURNAL_TITLE)}</full_title>
${issn ? `        <issn media_type="electronic">${xmlEsc(issn)}</issn>\n` : ''}      </journal_metadata>
      <journal_issue>
${issueDate}
        <journal_volume>
          <volume>${xmlEsc(issue.volume)}</volume>
        </journal_volume>
        <issue>${xmlEsc(issue.issue)}</issue>
      </journal_issue>
${articles.map(crossrefArticleXml).join('\n')}
    </journal>
  </body>
</doi_batch>
`;
}
