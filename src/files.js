// Shared helpers for treating URLs as "files": embeddable previews + icons.

// Returns an iframe-able preview URL for PDFs and Google Drive/Docs links.
export function embedSrc(url) {
  if (typeof url !== 'string' || !url || url === '#') return null;
  const drive = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  const doc = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (doc) return `https://docs.google.com/${doc[1]}/d/${doc[2]}/preview`;
  if (/\.pdf($|[?#])/i.test(url)) return url;
  return null;
}

// Icon + human kind for a URL, for file-tile rendering.
export function fileMeta(url = '') {
  const u = String(url).toLowerCase();
  if (/\.pdf($|[?#])/.test(u) || /drive\.google\.com\/file/.test(u)) return { icon: 'file-text', kind: 'PDF' };
  if (/docs\.google\.com\/document/.test(u)) return { icon: 'pen', kind: 'Doc' };
  if (/docs\.google\.com\/spreadsheets/.test(u)) return { icon: 'table', kind: 'Sheet' };
  if (/docs\.google\.com\/presentation/.test(u)) return { icon: 'presentation', kind: 'Slides' };
  if (/drive\.google\.com\/drive\/folders/.test(u)) return { icon: 'folder', kind: 'Folder' };
  if (/github\.com|gitlab\.com/.test(u)) return { icon: 'code', kind: 'Code' };
  if (/youtube\.com|youtu\.be|vimeo\.com|loom\.com/.test(u)) return { icon: 'video', kind: 'Video' };
  if (/notion\.so|notion\.site/.test(u)) return { icon: 'clipboard', kind: 'Notion' };
  if (/overleaf\.com/.test(u)) return { icon: 'scroll', kind: 'LaTeX' };
  if (/zotero|mendeley/.test(u)) return { icon: 'books', kind: 'Refs' };
  return { icon: 'link', kind: 'Link' };
}

// Direct-image URL for <img> tags. People paste Google Drive *share* links,
// which render nothing inside <img> — convert them to the direct-content host.
export function imageSrc(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);
  if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}`;
  return url.trim();
}
