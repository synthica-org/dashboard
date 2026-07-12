import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Badge, Button, Field, EmptyState, Pfp, Modal } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';
import { imageSrc } from '../../files.js';

// Format an ISO datetime slot as a friendly, locale-aware label.
const fmtSlot = (iso) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Researcher-facing Mentors directory + Calendly-style booking (ROLE_WORKFLOWS
// §7.2 / §7.3). Browse expertise mentors, filter by specialty, open a mentor to
// see their bio + open slots, pick a time, add a note, and confirm — which
// creates a booking, a calendar entry for both parties, and notifies the mentor.
export default function Mentors() {
  const toast = useToast();
  const [mentors, setMentors] = useState(null);
  const [specialties, setSpecialties] = useState([]);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(null);   // mentor being booked (detail)
  const [myBookings, setMyBookings] = useState([]);

  const load = useCallback(() => {
    api.mentors(filter).then(setMentors).catch(() => setMentors([]));
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.mentorSpecialties().then(setSpecialties).catch(() => {}); }, []);
  const loadBookings = useCallback(() => api.myMentorBookings().then(setMyBookings).catch(() => {}), []);
  useEffect(() => { loadBookings(); }, [loadBookings]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!mentors) return [];
    if (!needle) return mentors;
    return mentors.filter((m) =>
      m.name.toLowerCase().includes(needle) ||
      (m.specialties || []).some((s) => s.toLowerCase().includes(needle)) ||
      (m.institution || '').toLowerCase().includes(needle) ||
      (m.mentorBio || '').toLowerCase().includes(needle));
  }, [mentors, needle]);

  const upcoming = myBookings.filter((b) => b.status !== 'cancelled' && !b.past);

  return (
    <div>
      <div className="comp-hero">
        <span className="comp-hero-glow" />
        <div className="comp-hero-body">
          <span className="comp-hero-tag icon-label"><Icon name="graduation-cap" size={13} /> Expertise Mentors</span>
          <h1 className="comp-hero-title">Book a 1:1 with a subject-matter mentor</h1>
          <p className="comp-hero-desc">
            Get unstuck fast. Browse mentors by specialty, pick an open time, and book a call —
            you’ll both get a calendar invite and a meeting link.
          </p>
        </div>
      </div>

      {upcoming.length > 0 && (
        <Card style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ marginTop: 0 }}>Your upcoming calls</h3>
          <div className="stack">
            {upcoming.map((b) => (
              <div key={b.id} className="cal-item">
                <span className="guide-ico cal-item-icon" aria-hidden="true"><Icon name="video" size={17} /></span>
                <div className="cal-item-body">
                  <div className="cal-item-title">{b.mentorName}</div>
                  <div className="muted cal-item-meta">
                    {fmtSlot(b.slot)}{b.note ? ` · “${b.note}”` : ''}
                  </div>
                </div>
                <div className="cal-item-actions">
                  {b.meetingUrl && <a className="btn btn-sm btn-ghost" href={b.meetingUrl} target="_blank" rel="noreferrer"><span className="icon-label"><Icon name="video" size={13} /> Join link</span></a>}
                  <button className="btn btn-sm btn-ghost" onClick={() =>
                    api.cancelMentorBooking(b.id).then(() => { toast.success('Booking cancelled'); loadBookings(); load(); }).catch((e) => toast.error(e.message))}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="card-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' }}>
        <input
          placeholder="Search mentors by name, specialty, or affiliation"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 360, flex: '1 1 240px' }}
        />
      </div>

      {specialties.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.1rem' }}>
          <button className={`btn btn-sm ${filter === '' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('')}>All specialties</button>
          {specialties.map((s) => (
            <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(s)}>{s}</button>
          ))}
        </div>
      )}

      {mentors === null ? (
        <div className="page-loading">Loading mentors…</div>
      ) : shown.length === 0 ? (
        <EmptyState>
          {filter || needle
            ? 'No mentors match your search. Try a different specialty.'
            : 'No mentors yet — check back soon. Mentors set their specialties and availability to appear here.'}
        </EmptyState>
      ) : (
        <div className="grid grid-3">
          {shown.map((m) => <MentorCard key={m.id} m={m} onBook={() => setActive(m)} />)}
        </div>
      )}

      {active && (
        <BookModal
          mentorId={active.id}
          onClose={() => setActive(null)}
          onBooked={() => { setActive(null); load(); loadBookings(); toast.success('Booked! Check your calendar for the call.'); }}
        />
      )}
    </div>
  );
}

function MentorCard({ m, onBook }) {
  return (
    <Card className="comp-card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Pfp name={m.name} url={imageSrc(m.avatarUrl)} />
        <div style={{ minWidth: 0 }}>
          <Link to={`/p/${m.slug}`} style={{ fontWeight: 700 }}>{m.name}</Link>
          {m.institution && <div className="muted" style={{ fontSize: '0.78rem' }}>{m.institution}</div>}
        </div>
      </div>
      {m.specialties?.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem', margin: '0.6rem 0' }}>
          {m.specialties.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
        </div>
      )}
      {m.mentorBio && <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.7rem' }}>{m.mentorBio}</p>}
      <div className="card-row" style={{ alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {m.openSlots > 0 ? `${m.openSlots} open slot${m.openSlots === 1 ? '' : 's'}` : 'No open slots'}
        </span>
        <Button size="btn-sm" disabled={m.openSlots === 0} onClick={onBook}>
          {m.openSlots > 0 ? 'Book a call' : 'Fully booked'}
        </Button>
      </div>
    </Card>
  );
}

// Calendly-style booking modal: load the mentor's open slots, pick one, add an
// optional note, confirm.
function BookModal({ mentorId, onClose, onBooked }) {
  const toast = useToast();
  const [mentor, setMentor] = useState(null);
  const [slot, setSlot] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.mentor(mentorId).then((m) => {
      setMentor(m);
      if (m.slots?.[0]) setSlot(m.slots[0].slot);
    }).catch((e) => { toast.error(e.message); onClose(); });
  }, [mentorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    if (!slot) { toast.error('Pick a time slot first'); return; }
    setBusy(true);
    try {
      await api.bookMentor(mentorId, { slot, note });
      onBooked();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={mentor ? `Book ${mentor.name}` : 'Book a call'} onClose={onClose}>
      {!mentor ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <>
          {mentor.specialties?.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.6rem' }}>
              {mentor.specialties.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
            </div>
          )}
          {mentor.mentorBio && <p className="muted" style={{ marginTop: 0 }}>{mentor.mentorBio}</p>}

          {mentor.slots?.length === 0 ? (
            <EmptyState>This mentor has no open slots right now. Check back soon.</EmptyState>
          ) : (
            <>
              <Field label="Pick a time">
                <div className="stack">
                  {mentor.slots.map((s) => (
                    <label key={s.id} className={`slot-pick ${slot === s.slot ? 'sel' : ''}`}>
                      <input
                        type="radio"
                        name="slot"
                        checked={slot === s.slot}
                        onChange={() => setSlot(s.slot)}
                      />
                      <span>{fmtSlot(s.slot)}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Add a note (optional)">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="What would you like help with? e.g. 'Designing my survey for a psych study.'"
                />
              </Field>
              <div className="card-row" style={{ marginTop: '0.6rem' }}>
                <span className="muted" style={{ fontSize: '0.78rem' }}>You’ll both get a calendar invite + meeting link.</span>
                <Button onClick={confirm} disabled={busy || !slot}>{busy ? 'Booking…' : 'Confirm booking'}</Button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
