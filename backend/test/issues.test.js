import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../src/store.js';
import * as seed from '../src/seed.js';
import { citationFormats, crossrefBatchXml, parsePages, articleSlug } from '../src/doi.js';
import { sharePageHtml } from '../src/og.js';
import { ASSOCIATE_TOTAL_ROUNDS } from '../src/domain.js';

// Fresh seed before each test so issue-lifecycle mutations never leak.
beforeEach(async () => { await store.reset(); });

// Biology editors used to drive a paper through every tier (same pattern as
// editor-pipeline.test.js).
const reviewer1 = () => seed.editors.find((e) => e.role === 'reviews' && e.category === 'Biology');
const reviewer2 = () => seed.editors.filter((e) => e.role === 'reviews' && e.category === 'Biology')[1];
const senior = () => seed.editors.find((e) => e.role === 'senior' && e.category === 'Biology');
const associate = () => seed.editors.find((e) => e.role === 'associate' && e.category === 'Biology');
const chief = () => seed.editors.find((e) => e.role === 'chief');
const bioPaperId = () => store.papersForEditor(reviewer1().id).inbox[0].id;

function driveToPublishQueue(pid) {
  store.submitReviewDecision({ paperId: pid, editorId: reviewer1().id, decision: 'approve', comments: 'solid', recommendation: 'advance' });
  store.submitReviewDecision({ paperId: pid, editorId: reviewer2().id, decision: 'approve', comments: 'agree', recommendation: 'advance' });
  store.seniorDecision({ paperId: pid, editorId: senior().id, decision: 'approve', comments: 'screen ok' });
  for (let i = 0; i < ASSOCIATE_TOTAL_ROUNDS; i++) store.associateRound({ paperId: pid, editorId: associate().id, note: `round ${i + 1}` });
  store.seniorDecision({ paperId: pid, editorId: senior().id, decision: 'approve', comments: 'final ok' });
  store.chiefDecision({ paperId: pid, editorId: chief().id, decision: 'approve', comments: 'accept' });
}

describe('issue lifecycle — seed + open issue invariant', () => {
  it('seeds two closed 2025 issues plus one open issue (exactly one open)', () => {
    const issues = store.listJournalIssues();
    expect(issues.length).toBe(3);
    // Newest first.
    expect(issues.map((i) => [i.volume, i.issue])).toEqual([[2, 1], [1, 2], [1, 1]]);
    expect(issues.filter((i) => i.status === 'open').length).toBe(1);
    const closed = issues.filter((i) => i.status === 'closed');
    expect(closed.every((i) => String(i.publishedAt).startsWith('2025'))).toBe(true);
    // The seeded publications are distributed so both closed ToCs are non-empty.
    expect(issues.find((i) => i.volume === 1 && i.issue === 1).articleCount).toBeGreaterThan(0);
    expect(issues.find((i) => i.volume === 1 && i.issue === 2).articleCount).toBeGreaterThan(0);
  });

  it('every issue row carries the public shape (status, publishedAt, articleCount, editorial)', () => {
    for (const row of store.listJournalIssues()) {
      expect(row).toMatchObject({ volume: expect.any(Number), issue: expect.any(Number) });
      expect(['open', 'closed']).toContain(row.status);
      expect(row).toHaveProperty('publishedAt');
      expect(row).toHaveProperty('articleCount');
      expect(row).toHaveProperty('editorial');
    }
  });
});

describe('publishToJournal — open-issue auto-assignment', () => {
  it('assigns the open issue when the Director passes no volume/issue', () => {
    const open = store.openJournalIssue();
    const pid = bioPaperId();
    driveToPublishQueue(pid);
    const pub = store.publishToJournal({ paperId: pid });
    expect(pub.doi).toMatch(/^10\.55555\/synthica\./);
    expect(pub.volume).toBe(open.volume);
    expect(pub.issue).toBe(open.issue);
    // The paper shows in that issue's ToC + count.
    expect(store.journalIssueDetail(open.volume, open.issue).articles.some((a) => a.doi === pub.doi)).toBe(true);
  });

  it('still honors a manual volume/issue override', () => {
    const pid = bioPaperId();
    driveToPublishQueue(pid);
    const pub = store.publishToJournal({ paperId: pid, volume: 1, issue: 2, pages: '30–41' });
    expect(pub.volume).toBe(1);
    expect(pub.issue).toBe(2);
  });
});

describe('closeOpenIssue — next issue + year→volume rollover', () => {
  it('stamps publishedAt on the closing issue and opens issue+1 in the same year', () => {
    const before = store.openJournalIssue();
    const { closed, opened } = store.closeOpenIssue({ editorial: 'Wrap-up editorial.' });
    expect(closed.volume).toBe(before.volume);
    expect(closed.issue).toBe(before.issue);
    expect(closed.status).toBe('closed');
    expect(closed.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(closed.editorial).toBe('Wrap-up editorial.');
    // Same calendar year → same volume, next issue number.
    expect(opened).toMatchObject({ volume: before.volume, issue: before.issue + 1, status: 'open' });
    expect(store.listJournalIssues().filter((i) => i.status === 'open').length).toBe(1);
  });

  it('starts a new volume at Issue 1 when the calendar year rolls over', () => {
    const before = store.openJournalIssue();
    const nextYear = new Date().getFullYear() + 1;
    const { opened } = store.closeOpenIssue({ at: `${nextYear}-01-15T00:00:00.000Z` });
    expect(opened).toMatchObject({ volume: before.volume + 1, issue: 1, status: 'open' });
    expect(store.journalMeta().currentVolume).toBe(before.volume + 1);
  });

  it('rejects an unparsable close date', () => {
    expect(() => store.closeOpenIssue({ at: 'not-a-date' })).toThrow(/date/i);
  });
});

describe('moveArticleToIssue — validation', () => {
  it('re-files a publication into an existing issue', () => {
    const pub = store.listPublications()[0];
    const open = store.openJournalIssue();
    const moved = store.moveArticleToIssue({ publicationId: pub.id, volume: open.volume, issue: open.issue });
    expect(moved.volume).toBe(open.volume);
    expect(moved.issue).toBe(open.issue);
    expect(store.journalIssueDetail(open.volume, open.issue).articles.some((a) => a.id === pub.id)).toBe(true);
  });

  it('rejects a target issue that does not exist', () => {
    const pub = store.listPublications()[0];
    expect(() => store.moveArticleToIssue({ publicationId: pub.id, volume: 99, issue: 1 })).toThrow(/no such issue/i);
  });

  it('rejects an unknown publication', () => {
    expect(() => store.moveArticleToIssue({ publicationId: 'pub_nope', volume: 1, issue: 1 })).toThrow(/not found/i);
  });
});

describe('journal meta + issue detail — public endpoint shapes', () => {
  it('journalMeta exposes the masthead + the current (open) volume/issue', () => {
    const meta = store.journalMeta();
    expect(meta).toMatchObject({
      title: 'Synthica Journal',
      publisher: 'Synthica',
      frequency: 'Quarterly',
    });
    expect(meta.issn).toBeTruthy(); // real ISSN or the 'pending' placeholder
    expect(meta.journalUrl).toMatch(/^https?:\/\//);
    expect(meta.dashboardUrl).toMatch(/^https?:\/\//);
    const open = store.openJournalIssue();
    expect(meta.currentVolume).toBe(open.volume);
    expect(meta.currentIssue).toBe(open.issue);
  });

  it('journalIssueDetail returns the issue record + full ToC, and null when unknown', () => {
    const detail = store.journalIssueDetail(1, 1);
    expect(detail).toMatchObject({ volume: 1, issue: 1, status: 'closed' });
    expect(detail.publishedAt).toBeTruthy();
    expect(detail).toHaveProperty('editorial');
    expect(detail.articles.length).toBeGreaterThan(0);
    expect(detail.articles.every((a) => (a.volume || 1) === 1 && (a.issue || 1) === 1)).toBe(true);
    expect(store.journalIssueDetail(42, 7)).toBeNull();
  });
});

describe('Crossref deposit XML', () => {
  it('builds a doi_batch with the journal, the issue, and one record per article DOI', () => {
    const rec = store.getJournalIssue(1, 1);
    const articles = store.listPublications().filter((p) => (p.volume || 1) === 1 && (p.issue || 1) === 1);
    expect(articles.length).toBeGreaterThan(0);
    const xml = crossrefBatchXml({ issue: rec, articles });
    expect(xml).toContain('<doi_batch');
    expect(xml).toContain('<full_title>Synthica Journal</full_title>');
    expect(xml).toContain('<journal_issue>');
    expect(xml).toContain('<volume>1</volume>');
    expect(xml).toContain('<issue>1</issue>');
    for (const a of articles) {
      expect(xml).toContain(`<doi>${a.doi}</doi>`);
      expect(xml).toContain(`/articles/${articleSlug(a)}.html`);
    }
    // Contributors are split into given/surname; CC BY rides in <ai:program>.
    expect(xml).toContain('<surname>');
    expect(xml).toContain('creativecommons.org/licenses/by/4.0');
  });

  it('includes the ISSN only when one is configured', () => {
    const rec = store.getJournalIssue(1, 1);
    const articles = store.listPublications().filter((p) => (p.volume || 1) === 1 && (p.issue || 1) === 1);
    const prev = process.env.JOURNAL_ISSN;
    try {
      delete process.env.JOURNAL_ISSN;
      expect(crossrefBatchXml({ issue: rec, articles })).not.toContain('<issn');
      process.env.JOURNAL_ISSN = '1234-5678';
      expect(crossrefBatchXml({ issue: rec, articles })).toContain('<issn media_type="electronic">1234-5678</issn>');
    } finally {
      if (prev === undefined) delete process.env.JOURNAL_ISSN;
      else process.env.JOURNAL_ISSN = prev;
    }
  });
});

describe('citations + Scholar tags', () => {
  it('citation.bibtex carries the title, an author, and the year (escaped)', () => {
    const pub = store.listPublications()[0];
    const { bibtex, ris, apa } = citationFormats(pub);
    const year = String(pub.publishedAt).slice(0, 4);
    expect(bibtex).toContain('@article{');
    expect(bibtex).toContain(pub.title);
    expect(bibtex).toContain(pub.authors[0].name);
    expect(bibtex).toContain(`year = {${year}}`);
    expect(bibtex).toContain(`doi = {${pub.doi}}`);
    // RIS + APA come along in the same bundle.
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain(`TI  - ${pub.title}`);
    expect(apa).toContain(`(${year})`);
    expect(apa).toContain('Synthica Journal');
  });

  it('escapes BibTeX-special characters instead of leaking them raw', () => {
    const { bibtex } = citationFormats({
      title: 'Salt & Light: 100% of a {weird} title_case',
      authors: [{ name: 'Ana Q. Reyes' }],
      publishedAt: '2025-05-01',
      doi: '10.55555/synthica.2025.0009',
      volume: 1, issue: 1, pages: '5–9',
    });
    expect(bibtex).toContain('Salt \\& Light');
    expect(bibtex).toContain('100\\%');
    expect(bibtex).toContain('title\\_case');
    expect(bibtex).not.toContain('{weird}');
  });

  it('parsePages handles hyphen, en-dash, and single pages', () => {
    expect(parsePages('12-19')).toEqual({ first: '12', last: '19' });
    expect(parsePages('12–19')).toEqual({ first: '12', last: '19' });
    expect(parsePages('7')).toEqual({ first: '7', last: '7' });
    expect(parsePages('')).toEqual({ first: '', last: '' });
  });

  it('share pages emit Google Scholar citation_* tags and a ScholarlyArticle JSON-LD block', () => {
    const pub = store.listPublications().find((p) => (p.authors || []).length > 1) || store.listPublications()[0];
    const html = sharePageHtml(pub, { apiBase: 'https://api.synthica.org', siteBase: 'https://www.synthica.org' });
    expect(html).toContain(`<meta name="citation_title" content="${pub.title}">`);
    for (const a of pub.authors) expect(html).toContain(`<meta name="citation_author" content="${a.name}">`);
    expect(html).toContain('citation_publication_date');
    expect(html).toContain('<meta name="citation_journal_title" content="Synthica Journal">');
    expect(html).toContain(`<meta name="citation_volume" content="${pub.volume}">`);
    expect(html).toContain(`<meta name="citation_issue" content="${pub.issue}">`);
    const { first, last } = parsePages(pub.pages);
    expect(html).toContain(`<meta name="citation_firstpage" content="${first}">`);
    expect(html).toContain(`<meta name="citation_lastpage" content="${last}">`);
    expect(html).toContain(`<meta name="citation_doi" content="${pub.doi}">`);
    expect(html).toContain('citation_pdf_url');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"ScholarlyArticle"');
  });
});
