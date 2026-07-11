import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

// All volumes → issues, as an IEEE-style index grid.
export default function JournalVolumes() {
  const [volumes, setVolumes] = useState(null);
  useEffect(() => { api.journalVolumes().then(setVolumes).catch(() => setVolumes([])); }, []);

  return (
    <div className="jr-page">
      <JournalMast />
      <main className="jr-body">
        <nav className="art-crumbs"><Link to="/journal">Journal</Link><span>›</span><span>Volumes &amp; issues</span></nav>
        <h1 className="jr-title" style={{ marginBottom: '0.3rem' }}>Volumes &amp; issues</h1>
        <p className="jr-sub" style={{ marginBottom: '1.5rem' }}>Every issue of the Synthica Journal, newest first.</p>

        {!volumes ? <div className="page-loading">Loading…</div> : volumes.length === 0 ? (
          <p className="muted">No issues published yet.</p>
        ) : (
          <div className="stack" style={{ gap: '1.5rem' }}>
            {volumes.map((v) => (
              <section key={v.volume} className="jr-vol-block">
                <h2 className="jr-vol-title">Volume {v.volume}</h2>
                <div className="jr-issue-grid">
                  {v.issues.map((is) => (
                    // No "Vol. N" eyebrow — the card already sits under the volume heading.
                    <Link key={is.issue} to={`/journal/vol/${v.volume}/issue/${is.issue}`} className="jr-issue-card">
                      <span className="jr-issue-no">Issue {is.issue}</span>
                      <span className="jr-issue-count">{is.count} article{is.count === 1 ? '' : 's'}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
      <JournalFooter />
    </div>
  );
}
