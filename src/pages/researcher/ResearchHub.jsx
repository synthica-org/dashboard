import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState, Modal } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';
import { imageSrc } from '../../files.js';
import { Pfp } from '../../components/ui.jsx';

// Browse all open project listings; apply to one. Lead-side listing management
// lives in the dedicated Lead hub (/researcher/lead).
export default function ResearchHub() {
  const { user } = useAuth();
  const isLead = (user?.tags || []).includes('lead_researcher');
  const [listings, setListings] = useState([]);
  const [filter, setFilter] = useState('All');
  const [applied, setApplied] = useState({});
  const [applying, setApplying] = useState(null); // listing being applied to (opens modal)
  const [error, setError] = useState('');

  const load = useCallback(() => api.listings().then(setListings).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const categories = ['All', ...new Set(listings.map((l) => l.category))];
  const shown = filter === 'All' ? listings : listings.filter((l) => l.category === filter);

  const onApplied = (listingId) => setApplied((a) => ({ ...a, [listingId]: true }));

  return (
    <div>
      <h1 className="page-title">Research Hub</h1>
      <p className="page-sub">Every open project listing across Synthica — find one and apply.</p>
      <div className="info-block" style={{ marginBottom: '1rem' }}>
        {user?.resumeUrl
          ? <span className="icon-label"><Icon name="paperclip" size={13} /> Your résumé is attached automatically when you apply.</span>
          : <>No résumé on file — <Link to="/researcher/tools">add one in Tools</Link> to auto-apply.</>}
      </div>
      {error && <div className="login-error">{error}</div>}

      {isLead && (
        <Card style={{ marginBottom: '1.25rem' }}>
          <div className="card-row" style={{ flexWrap: 'wrap' }}>
            <div className="row" style={{ flex: '1 1 200px', minWidth: 0, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span className="guide-ico" aria-hidden="true"><Icon name="rocket" size={18} /></span>
              <div style={{ minWidth: 0 }}>
                <strong>Manage your listings in the Lead hub</strong>
                <div className="muted" style={{ fontSize: '0.82rem' }}>Create projects, post listings with custom questions, and review applicants there.</div>
              </div>
            </div>
            <Link className="btn btn-primary btn-sm" to="/researcher/lead" style={{ marginLeft: 'auto', flex: 'none' }}>Open Lead hub</Link>
          </div>
        </Card>
      )}

      {applying && (
        <ApplyModal
          listing={applying}
          onClose={() => setApplying(null)}
          onApplied={() => { onApplied(applying.id); setApplying(null); }}
        />
      )}

      <div className="row" style={{ marginBottom: '1.25rem' }}>
        {categories.map((c) => (
          <button
            key={c}
            className={`btn btn-sm ${filter === c ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState>No listings in this category yet.</EmptyState>
      ) : (
        <div className="grid grid-3">
          {shown.map((l) => (
            <Card key={l.id} className="paper-card listing-card">
              {l.bannerUrl && <img className="listing-banner" src={imageSrc(l.bannerUrl)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              <div className="card-row">
                <Badge>{l.category}</Badge>
                <span className="muted">{Math.max(0, (l.spots || 0) - Math.max(0, (l.filled || 1) - 1))} of {l.spots} spot{l.spots === 1 ? '' : 's'} open</span>
              </div>
              <h3>{l.title}</h3>
              {l.customApplication && <Badge tone="gold"><Icon name="pen" size={11} /> Custom application</Badge>}
              <p className="muted" style={{ margin: '0.4rem 0 0.6rem' }}>{l.description}</p>
              {l.lookingFor && (
                <div className="row" style={{ gap: '0.3rem', marginBottom: '0.6rem' }}>
                  <span className="muted" style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Looking for</span>
                  {l.lookingFor.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t} tone="gold">{t}</Badge>)}
                </div>
              )}
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="pfp-stack" title={(l.team || []).map((t) => t.name).join(', ')}>
                  {(l.team || []).slice(0, 5).map((t) => (
                    <Pfp key={t.id} name={t.name} url={imageSrc(t.avatarUrl)} size="xs" />
                  ))}
                  {(l.team || []).length > 5 && <span className="pfp pfp-xs pfp-more">+{l.team.length - 5}</span>}
                  <span className="muted" style={{ marginLeft: '0.45rem', fontSize: '0.78rem' }}>{l.filled || 1} on board</span>
                </span>
                {l.leadId === user.id ? (
                  <Badge tone="gold">Your listing</Badge>
                ) : (
                  <Button
                    className="btn-sm"
                    disabled={applied[l.id]}
                    onClick={() => setApplying(l)}
                    variant={applied[l.id] ? 'ghost' : 'primary'}
                  >
                    {applied[l.id] ? <span className="icon-label">Applied <Icon name="check" size={13} /></span> : 'Apply'}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Apply to a listing. For listings in custom application mode (§5.4) the lead's
// questions are shown and required ones must be answered; otherwise it's just a
// short message. The applicant's profile snapshot is attached server-side.
function ApplyModal({ listing, onClose, onApplied }) {
  const toast = useToast();
  const questions = listing.customApplication ? (listing.customQuestions || []) : [];
  const [message, setMessage] = useState(`Interested in ${listing.title}`);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    // Client-side guard mirrors the server's required-answer check.
    for (const q of questions) {
      if (q.required !== false && !String(answers[q.id] || '').trim()) {
        toast.error(`Please answer: ${q.label}`);
        return;
      }
    }
    setBusy(true);
    try {
      await api.apply({ listingId: listing.id, message, answers: questions.length ? answers : undefined });
      toast.success('Application sent');
      onApplied();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Apply — ${listing.title}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>
          {questions.length
            ? 'This lead asks a few questions. Your profile snapshot is shared automatically.'
            : 'Send a short note. Your profile snapshot is shared automatically.'}
        </p>
        <Field label="Message to the lead">
          <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Why you're a good fit…" />
        </Field>
        {questions.map((q) => (
          <Field key={q.id} label={q.required === false ? q.label : `${q.label} *`}>
            <textarea
              rows={2}
              value={answers[q.id] || ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              required={q.required !== false}
            />
          </Field>
        ))}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <Button type="button" variant="ghost" className="btn-sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="btn-sm" disabled={busy}>{busy ? 'Sending…' : 'Submit application'}</Button>
        </div>
      </form>
    </Modal>
  );
}
