// Resolve a previewable embed URL (Google Drive, YouTube, direct PDF) and a
// small <Embed> component. Returns null for non-embeddable links so callers can
// fall back to a plain link.
export function embedSrc(url) {
  if (typeof url !== 'string' || !url || url === '#') return null;
  const drive = url.match(/\/file\/d\/([^/]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  if (/\.pdf($|[?#])/i.test(url)) return url;
  return null;
}

export function Embed({ url, height = 360, title = 'Embedded preview' }) {
  const src = embedSrc(url);
  if (!src) return null;
  return (
    <iframe
      src={src}
      title={title}
      loading="lazy"
      style={{
        width: '100%',
        height,
        border: '1px solid var(--border)',
        borderRadius: 12,
        marginTop: '0.5rem',
      }}
      allow="fullscreen"
    />
  );
}
