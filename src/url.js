// Render-time URL guard (defense-in-depth). The backend sanitizes on write, but
// older rows may predate that, and React will happily render a javascript:
// href. Wrap any user-supplied URL with this before using it in href.
const SAFE = ['http:', 'https:', 'mailto:'];

export function safeHref(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  const candidate = hasScheme ? s : `https://${s}`;
  try {
    return SAFE.includes(new URL(candidate).protocol) ? candidate : '';
  } catch {
    return '';
  }
}
