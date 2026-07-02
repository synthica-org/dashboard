// Per-paper Open Graph share cards.
//
// /api/journal/publications/:id/og.png   1200×630 PNG (what crawlers embed)
// /api/journal/publications/:id/share    HTML with per-paper OG tags that
//                                        forwards humans to the article page
//
// The card is composed as SVG and rasterized with resvg using bundled Lato
// fonts (no system-font dependency). Static hosting can't serve per-paper
// meta tags, so share links point at the backend's /share URL instead.

import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePages, journalIssn } from './doi.js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'fonts');
const FONTS = [path.join(FONT_DIR, 'Lato-Regular.ttf'), path.join(FONT_DIR, 'Lato-Bold.ttf')];

const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Greedy word-wrap sized for Lato Bold — resvg has no layout engine, so lines
// are broken here. avgCharW is tuned for the title size used below.
function wrapText(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (line && lines.length === maxLines) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{3}$/, '') + '…';
  return lines;
}

export function ogCardSvg(pub) {
  const W = 1200, H = 630;
  const authors = (pub.authors || []).map((a) => a.name).slice(0, 3).join(', ') + ((pub.authors || []).length > 3 ? ' et al.' : '');
  const titleLines = wrapText(pub.title || 'Untitled', 38, 3);
  const titleSpans = titleLines
    .map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : 64}">${esc(l)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c2d54"/><stop offset="0.55" stop-color="#1a6bb5"/><stop offset="1" stop-color="#2589ed"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="1080" cy="-40" r="260" fill="#ffffff" opacity="0.06"/>
  <circle cx="120" cy="690" r="300" fill="#ffd700" opacity="0.07"/>
  <text x="80" y="96" font-family="Lato" font-weight="700" font-size="34" fill="#ffd700" letter-spacing="2">SYNTHICA JOURNAL</text>
  ${pub.category ? `<rect x="80" y="130" rx="17" width="${34 + pub.category.length * 13}" height="38" fill="#ffffff" opacity="0.14"/>
  <text x="${97 + (pub.category.length * 13) / 2}" y="156" font-family="Lato" font-size="22" fill="#ffffff" text-anchor="middle">${esc(pub.category)}</text>` : ''}
  <text x="80" y="268" font-family="Lato" font-weight="700" font-size="54" fill="#ffffff">${titleSpans}</text>
  <text x="80" y="${268 + titleLines.length * 64 + 14}" font-family="Lato" font-size="30" fill="#cfe3fa">${esc(authors)}</text>
  <text x="80" y="566" font-family="Lato" font-size="24" fill="#9cc4ef">${esc(pub.doi ? `doi.org/${pub.doi}` : 'synthica.org')}   ·   Peer-reviewed student research</text>
</svg>`;
}

export function ogCardPng(pub) {
  const resvg = new Resvg(ogCardSvg(pub), {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Lato' },
  });
  return resvg.render().asPng();
}

// Google Scholar "Highwire Press" citation_* tags + a schema.org JSON-LD
// ScholarlyArticle block, so a crawled share page is fully indexable.
function scholarBlock(pub, { pdfUrl, target }) {
  const tag = (name, content) => (content ? `<meta name="${name}" content="${esc(content)}">` : '');
  const authors = (pub.authors || []).map((a) => a.name).filter(Boolean);
  const pubDate = String(pub.publishedAt || '').slice(0, 10);
  const { first, last } = parsePages(pub.pages);
  const issn = journalIssn();
  const tags = [
    tag('citation_title', pub.title),
    ...authors.map((n) => tag('citation_author', n)),
    tag('citation_publication_date', pubDate.replace(/-/g, '/')),
    tag('citation_journal_title', 'Synthica Journal'),
    tag('citation_issn', issn),
    tag('citation_volume', pub.volume),
    tag('citation_issue', pub.issue),
    tag('citation_firstpage', first),
    tag('citation_lastpage', last),
    tag('citation_pdf_url', pdfUrl),
    tag('citation_doi', pub.doi),
  ].filter(Boolean).join('\n');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: pub.title,
    name: pub.title,
    author: authors.map((n) => ({ '@type': 'Person', name: n })),
    datePublished: pubDate,
    isPartOf: {
      '@type': 'PublicationIssue',
      issueNumber: pub.issue ?? undefined,
      isPartOf: {
        '@type': 'PublicationVolume',
        volumeNumber: pub.volume ?? undefined,
        isPartOf: { '@type': 'Periodical', name: 'Synthica Journal', ...(issn ? { issn } : {}) },
      },
    },
    publisher: { '@type': 'Organization', name: 'Synthica' },
    ...(pub.abstract ? { abstract: String(pub.abstract).slice(0, 500) } : {}),
    ...(pub.doi ? { identifier: `https://doi.org/${pub.doi}`, sameAs: `https://doi.org/${pub.doi}` } : {}),
    license: 'https://creativecommons.org/licenses/by/4.0/',
    url: target,
  };
  // `<` is escaped so a title containing "</script>" can't break out of the block.
  return `${tags}\n<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;
}

// Minimal share page: crawlers read the OG tags; humans get forwarded to the
// article on the marketing site.
export function sharePageHtml(pub, { apiBase, siteBase }) {
  const ogImage = `${apiBase}/api/journal/publications/${encodeURIComponent(pub.id)}/og.png`;
  const target = `${siteBase}/article.html?id=${encodeURIComponent(pub.id)}`;
  const desc = String(pub.abstract || '').slice(0, 200);
  // Scholar wants an absolute PDF link; uploads-relative paths get the API base.
  const pdfUrl = pub.pdfUrl ? (/^https?:\/\//i.test(pub.pdfUrl) ? pub.pdfUrl : `${apiBase}${pub.pdfUrl.startsWith('/') ? '' : '/'}${pub.pdfUrl}`) : '';
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(pub.title)} — Synthica Journal</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="Synthica Journal">
<meta property="og:title" content="${esc(pub.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(pub.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
${scholarBlock(pub, { pdfUrl, target })}
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<link rel="canonical" href="${esc(target)}">
</head><body>
<p>Redirecting to <a href="${esc(target)}">${esc(pub.title)}</a>…</p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`;
}
