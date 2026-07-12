import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { getDefaultHomePath } from '../views.js';
import { BrandMark } from './Icon.jsx';

// Shared masthead + footer for the public Synthica Journal pages — a deliberately
// academic chrome (serif wordmark, thin rules) distinct from the app dashboard.
export function JournalMast({ preprint = false }) {
  const { user } = useAuth();
  return (
    <header className={`jr-mast${preprint ? ' jr-mast-pre' : ''}`}>
      <div className="jr-mast-inner">
        <Link to={preprint ? '/preprints' : '/journal'} className="jr-wordmark">
          <BrandMark size={26} /><span>Synthica <em>{preprint ? 'Preprints' : 'Journal'}</em></span>
        </Link>
        <nav className="jr-nav">
          {preprint ? (
            <>
              <NavLink to="/preprints" end className={({ isActive }) => isActive ? 'on' : ''}>Browse</NavLink>
              <NavLink to="/journal" className={({ isActive }) => isActive ? 'on' : ''}>Journal</NavLink>
              <NavLink to="/archive" className={({ isActive }) => isActive ? 'on' : ''}>Archive</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/journal" end className={({ isActive }) => isActive ? 'on' : ''}>Home</NavLink>
              <NavLink to="/journal/volumes" className={({ isActive }) => isActive ? 'on' : ''}>Volumes &amp; issues</NavLink>
              <NavLink to="/preprints" className={({ isActive }) => isActive ? 'on' : ''}>Preprints</NavLink>
              <NavLink to="/archive" className={({ isActive }) => isActive ? 'on' : ''}>Archive</NavLink>
              <a href="/api/journal/rss" target="_blank" rel="noreferrer">RSS</a>
            </>
          )}
        </nav>
        <div className="jr-mast-cta">
          {user
            ? <Link className="btn btn-primary btn-sm" to={getDefaultHomePath(user)}>Dashboard</Link>
            : <Link className="btn btn-primary btn-sm" to="/login">Sign in</Link>}
        </div>
      </div>
    </header>
  );
}

export function JournalFooter() {
  return (
    <footer className="jr-footer">
      <div className="jr-footer-inner">
        <div>
          <div className="jr-wordmark sm"><BrandMark size={20} /><span>Synthica <em>Journal</em></span></div>
          <p className="muted" style={{ maxWidth: 420, fontSize: '0.84rem', marginTop: '0.6rem' }}>
            Open-access, peer-reviewed research by student scientists. Every article is free to read, reuse, and cite under CC BY 4.0.
          </p>
        </div>
        <div className="jr-footer-links">
          <Link to="/journal/volumes">Browse all issues</Link>
          <Link to="/archive">Search the archive</Link>
          <a href="/api/journal/rss" target="_blank" rel="noreferrer">RSS feed</a>
          <Link to="/login">Submit your work</Link>
        </div>
      </div>
      <div className="jr-footer-base muted">© {new Date().getFullYear()} Synthica · ISSN pending · Published under CC BY 4.0</div>
    </footer>
  );
}
