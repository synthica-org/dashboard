import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Badge, Button, EmptyState } from '../../components/ui.jsx';
import { useAuth } from '../../auth.jsx';
import { useToast } from '../../components/toast.jsx';
import NewsFeed from '../../components/NewsFeed.jsx';
import NewsPoster from '../../components/NewsPoster.jsx';
import PaperModal, { CoReviewerChip } from './PaperModal.jsx';

const CAN_POST_NEWS = ['senior', 'chief', 'director'];

// Window event carrying the current inbox size; EditorApp listens to keep the
// sidebar queue badge in sync with every fetch (poll + decisions).
export const QUEUE_COUNT_EVENT = 'editor-queue-count';

// Per-tier framing: each editor role sees a dedicated queue explaining its job
// in the pipeline (JOURNAL_PIPELINE §9).
const TIERS = {
  reviews: {
    title: 'Reviews Editor — screening queue',
    sub: 'First-pass screening. Two reviews editors read each paper single-blind; it only advances when you both approve.',
    job: [
      'Read the paper and leave feedback (always required).',
      'Approve and add a recommendation, or reject.',
      'You can see the other reviews editor’s call live once they submit.',
    ],
    queueLabel: 'Papers awaiting your review',
    empty: {
      icon: 'inbox',
      title: 'No papers to review',
      body: 'New submissions in your subject land here the moment an author submits. Each paper goes to two reviews editors, and it only advances when you both approve.',
    },
  },
  senior: {
    title: 'Senior Editor — quality checks',
    sub: 'You run two checks: screening right after the reviews editors, and the final check after the associate’s revision rounds.',
    job: [
      'Screening: read both reviews decisions, then approve to send to an associate editor — or reject.',
      'Final check: read the full feedback chain and the author’s details, then approve to send to the editor-in-chief — or reject.',
      'Feedback is required; no recommendation needed at this stage.',
    ],
    queueLabel: 'Papers awaiting a senior decision',
    empty: {
      icon: 'shield',
      title: 'No papers awaiting a senior decision',
      body: 'Papers reach you twice: for screening the moment both reviews editors approve, and for the final check after the associate editor finishes two revision rounds with the author.',
    },
  },
  associate: {
    title: 'Associate Editor — author collaboration',
    sub: 'You work directly with the author across two revision rounds. This is a collaboration stage, not a gate — there is no approve/reject here.',
    job: [
      'Contact the author (email shown on the paper) and run each revision round.',
      'Log each completed round; the counter tracks 1 → 2.',
      'After the second round the paper moves to the senior editor’s final check.',
    ],
    queueLabel: 'Papers in revision with you',
    empty: {
      icon: 'pen',
      title: 'No papers in revision with you',
      body: 'Papers arrive here once a senior editor approves them at screening. From there you run two revision rounds with the author before the senior final check.',
    },
  },
  chief: {
    title: 'Editor-in-Chief — final sign-off',
    sub: 'The final scientific decision. Approve to hand the paper to the Director for publication, or reject.',
    job: [
      'Review the full history — every prior decision and round.',
      'Approve with feedback to send it to the Director’s publish queue, or reject with feedback.',
    ],
    queueLabel: 'Papers awaiting your sign-off',
    empty: {
      icon: 'check-circle',
      title: 'No papers awaiting sign-off',
      body: "Papers arrive after the senior editor's final check — the last gate before the Director. Approving hands them to the Director's publish queue.",
    },
  },
};

export default function EditorDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const tier = TIERS[user.role];
  const [data, setData] = useState({ inbox: [], archive: [] });
  const [active, setActive] = useState(null); // paper open in modal
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');

  const inbox = useMemo(() => {
    let xs = data.inbox;
    if (query.trim()) {
      const q = query.toLowerCase();
      xs = xs.filter((p) => p.title.toLowerCase().includes(q) || p.authorName.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    const by = {
      newest: (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt),
      oldest: (a, b) => new Date(a.submittedAt) - new Date(b.submittedAt),
      title: (a, b) => a.title.localeCompare(b.title),
      category: (a, b) => a.category.localeCompare(b.category),
    };
    return [...xs].sort(by[sort] || by.newest);
  }, [data.inbox, query, sort]);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    api
      .editorPapers()
      .then((d) => {
        setData(d);
        // Keep the nav queue badge (EditorApp) in sync with what we just
        // fetched — it updates instantly after decisions and on each poll.
        window.dispatchEvent(new CustomEvent(QUEUE_COUNT_EVENT, { detail: d.inbox?.length ?? 0 }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Initial load + live polling so new papers/decisions appear without a reload.
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 15000);
    return () => clearInterval(t);
  }, [load]);

  // Refresh after any decision, and close the modal. The modal passes a
  // consequence message ("Approved — moves to Senior screening") so the toast
  // states what the decision just triggered.
  const onActed = (message) => {
    setActive(null);
    load(true);
    toast.success(message || 'Saved');
  };

  if (loading) return <p className="muted">Loading your queue…</p>;

  // Fallback for roles without a personal queue (EditorApp normally redirects
  // them before this renders) — offer the places they can act, not a dead end.
  if (!tier) {
    return (
      <div>
        <h1 className="page-title">Editorial overview</h1>
        <p className="page-sub">Your role works across the whole pipeline rather than a personal review queue.</p>
        <NewsFeed />
        {CAN_POST_NEWS.includes(user.role) && <NewsPoster />}
        <EmptyState>
          <div className="row" style={{ justifyContent: 'center', gap: '0.5rem' }}>
            <Link className="btn btn-primary btn-sm" to="/editor/director">Open the Director Desk</Link>
            <Link className="btn btn-ghost btn-sm" to="/editor/admin">Go to Admin</Link>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">{tier.title}</h1>
      <p className="page-sub">{tier.sub}</p>
      {error && <div className="login-error">{error}</div>}

      <div className="info-block" style={{ marginBottom: '1rem' }}>
        <strong>Your job at this stage</strong>
        <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
          {tier.job.map((line, i) => (
            <li key={i} style={{ marginTop: i ? '0.25rem' : 0 }}>{line}</li>
          ))}
        </ul>
      </div>

      <NewsFeed />
      {CAN_POST_NEWS.includes(user.role) && <NewsPoster />}

      <div className="row" style={{ margin: '0 0 1rem' }}>
        <input
          placeholder="Search title, author, subject…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title">Title A–Z</option>
          <option value="category">Subject</option>
        </select>
      </div>

      <h2 className="section-title" style={{ marginBottom: '0.75rem' }}>
        {tier.queueLabel} <Badge tone="gray">{inbox.length}</Badge>
      </h2>
      {inbox.length === 0 ? (
        query ? (
          <EmptyState>No papers match your search.</EmptyState>
        ) : (
          <EmptyState icon={tier.empty.icon} title={tier.empty.title}>{tier.empty.body}</EmptyState>
        )
      ) : (
        <div className="grid grid-2">
          {inbox.map((p) => (
            <PaperCard key={p.id} paper={p} role={user.role} onOpen={() => setActive(p)} />
          ))}
        </div>
      )}

      {data.archive?.length > 0 && (
        <>
          <h2 className="section-title" style={{ margin: '2rem 0 0.75rem' }}>
            History <Badge tone="gray">{data.archive.length}</Badge>
          </h2>
          <div className="grid grid-2">
            {data.archive.map((p) => (
              <PaperCard key={p.id} paper={p} role={user.role} archived onOpen={() => setActive(p)} />
            ))}
          </div>
        </>
      )}

      {active && <PaperModal paper={active} role={user.role} onClose={() => setActive(null)} onActed={onActed} />}
    </div>
  );
}

function PaperCard({ paper, role, archived, onOpen }) {
  return (
    <Card className="paper-card">
      <div className="card-row">
        <Badge>{paper.category}</Badge>
        <span className="muted">#{paper.id.replace('paper_', '')}</span>
      </div>
      <h3>{paper.title}</h3>
      <p className="paper-meta">
        {paper.authorName} · {new Date(paper.submittedAt).toLocaleDateString()}
      </p>

      {/* Reviews editor, queue cards only: the paper's fate depends on BOTH
          reviewers approving, so show the co-reviewer status at a glance
          (pending / approved / declined). Archived cards show "Your call". */}
      {role === 'reviews' && !archived && (
        <p style={{ marginBottom: '0.6rem' }}>
          <CoReviewerChip coReview={paper.coReview} />
        </p>
      )}
      {role === 'reviews' && archived && paper.myReview && (
        <p className="muted" style={{ marginBottom: '0.6rem' }}>
          Your call:{' '}
          <Badge tone={paper.myReview.decision === 'approve' ? 'green' : 'red'}>
            {paper.myReview.decision === 'approve' ? 'approved' : 'declined'}
          </Badge>
        </p>
      )}
      {role === 'associate' && (
        <p className="muted" style={{ marginBottom: '0.6rem' }}>
          Round {paper.associateRounds} of 2
        </p>
      )}

      <Button variant="ghost" className="btn-sm" onClick={onOpen}>
        See more
      </Button>
    </Card>
  );
}
