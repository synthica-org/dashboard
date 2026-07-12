/** Full-page loading state — used for auth gates, route suspense, and data fetches. */
export default function PageLoader({ label = 'Loading', compact = false }) {
  return (
    <div className={`page-loader ${compact ? 'page-loader-compact' : ''}`} role="status" aria-live="polite" aria-busy="true">
      <div className="page-loader-card">
        <div className="page-loader-orbit" aria-hidden="true">
          <span className="page-loader-ring" />
          <span className="page-loader-core" />
        </div>
        <p className="page-loader-label">{label}</p>
      </div>
    </div>
  );
}
