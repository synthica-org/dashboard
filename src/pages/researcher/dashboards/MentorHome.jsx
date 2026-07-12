import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth } from '../../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState, Pfp } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../components/toast.jsx';
import { imageSrc } from '../../../files.js';

const fmtSlot = (iso) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Mentor's own workspace (ROLE_WORKFLOWS §7.1): edit specialties + bio, manage
// availability slots, and see upcoming/past bookings (cancel to free a slot and
// notify the researcher). "Connect Google Calendar" is a documented stub — no
// real OAuth; it only flips an in-app flag so two-way sync can be wired later.
export default function MentorHome() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);

  const load = useCallback(() => api.mentorDashboard().then(setData).catch(() => setData(null)), []);
  useEffect(() => { load(); }, [load]);

  // Guard: only mentors have this dashboard. (Nav already restricts the link,
  // but a direct visit by a non-mentor should explain itself.)
  const isMentor = (user?.tags || []).includes('expertise_mentor');
  if (!isMentor) {
    return (
      <div>
        <h1 className="page-title">Expertise mentor</h1>
        <EmptyState>
          You don’t have the Expertise Mentor role yet. Ask an auditor to grant it, then return here to set your
          specialties and availability.
        </EmptyState>
      </div>
    );
  }

  if (!data) return <div className="page-loading">Loading your mentor dashboard…</div>;

  const upcoming = data.bookings.filter((b) => b.status !== 'cancelled' && !b.past);
  const past = data.bookings.filter((b) => b.status === 'cancelled' || b.past);

  return (
    <div>
      {/* DashboardHero */}
      <div className="comp-hero">
        <span className="comp-hero-glow" />
        <div className="comp-hero-body">
          <span className="comp-hero-tag"><Icon name="graduation-cap" size={13} /> Expertise Mentor</span>
          <h1 className="comp-hero-title">Advise researchers 1:1</h1>
          <p className="comp-hero-desc">
            Share your specialties, open up times you’re free, and let researchers book a call.
            You’ll get a notification and a calendar entry for each booking.
          </p>
          <CalendarStub connected={data.calendarConnected} onChange={load} />
        </div>
      </div>

      {/* RoleGuide */}
      <Card style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>How mentoring works</h3>
        <ol className="role-guide">
          <li><strong>Set your specialties</strong> so researchers can find you by topic.</li>
          <li><strong>Add availability</strong> — the future times you’re open for a call.</li>
          <li><strong>Researchers book a slot</strong>; it lands on your calendar and notifies you.</li>
          <li><strong>Join the call</strong> via the meeting link, or cancel to free the slot.</li>
        </ol>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 1fr)', alignItems: 'start', gap: '1.25rem' }}>
        <ProfileCard data={data} onSaved={setData} />
        <AvailabilityCard data={data} onChanged={setData} />
      </div>

      <Card style={{ marginTop: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>Upcoming bookings</h3>
        {upcoming.length === 0 ? (
          <EmptyState>
            No bookings yet. {data.slots.filter((s) => !s.booked && !s.past).length === 0
              ? 'Add availability above to start receiving bookings.'
              : 'Your open slots are live — researchers can book them from the Mentors page.'}
          </EmptyState>
        ) : (
          <div className="stack">
            {upcoming.map((b) => <BookingRow key={b.id} b={b} onChanged={setData} />)}
          </div>
        )}
      </Card>

      {past.length > 0 && (
        <Card style={{ marginTop: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Past &amp; cancelled</h3>
          <div className="stack">
            {past.map((b) => <BookingRow key={b.id} b={b} past />)}
          </div>
        </Card>
      )}
    </div>
  );
}

// Clearly-labeled, non-functional Google Calendar stub. Tooltip explains that
// two-way sync is wireable later; toggling only flips an in-app flag.
function CalendarStub({ connected, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api.connectMentorCalendar(!connected);
      toast.info(connected ? 'Calendar disconnected (demo)' : 'Calendar “connected” — this is a demo stub');
      onChange();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost cal-stub-btn"
      onClick={toggle}
      disabled={busy}
      title="Demo only — two-way Google Calendar sync isn’t wired up yet. Bookings already appear on your in-app calendar."
    >
      {connected ? <><Icon name="check" size={14} /> Google Calendar connected (demo)</> : <><Icon name="calendar" size={14} /> Connect Google Calendar</>}
    </button>
  );
}

function ProfileCard({ data, onSaved }) {
  const toast = useToast();
  const [specialties, setSpecialties] = useState((data.specialties || []).join(', '));
  const [bio, setBio] = useState(data.mentorBio || '');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await api.setMentorProfile({ specialties, mentorBio: bio });
      onSaved(next);
      toast.success('Profile updated');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Your mentor profile</h3>
      <form onSubmit={save}>
        <Field label="Specialties (comma-separated)">
          <input
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="e.g. Biology, Statistics, Python"
          />
        </Field>
        {(data.specialties || []).length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.6rem' }}>
            {data.specialties.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
          </div>
        )}
        <Field label="Mentor bio">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={600}
            placeholder="Tell researchers what you can help with and what to bring to a call."
          />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
      </form>
    </Card>
  );
}

function AvailabilityCard({ data, onChanged }) {
  const toast = useToast();
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!slot) { toast.error('Pick a date and time'); return; }
    setBusy(true);
    try {
      const next = await api.setMentorAvailability({ slot: new Date(slot).toISOString() });
      onChanged(next);
      setSlot('');
      toast.success('Availability added');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const remove = (s) =>
    api.removeMentorSlot(s.id).then(onChanged).then(() => toast.success('Slot removed')).catch((e) => toast.error(e.message));

  // Open future slots first, then booked, then past (greyed).
  const slots = [...data.slots].sort((a, b) => a.slot.localeCompare(b.slot));
  const openCount = slots.filter((s) => !s.booked && !s.past).length;

  return (
    <Card>
      <div className="card-row" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Availability</h3>
        <Badge tone={openCount > 0 ? 'green' : 'gray'}>{openCount} open</Badge>
      </div>
      <form onSubmit={add} className="row" style={{ gap: '0.5rem', margin: '0.7rem 0 1rem', flexWrap: 'wrap' }}>
        <input
          type="datetime-local"
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
          style={{ flex: '1 1 200px' }}
        />
        <Button type="submit" size="btn-sm" disabled={busy}>{busy ? 'Adding…' : '+ Add slot'}</Button>
      </form>

      {slots.length === 0 ? (
        <EmptyState>Set your availability to receive bookings.</EmptyState>
      ) : (
        <div className="stack">
          {slots.map((s) => (
            <div key={s.id} className="cal-item" style={s.past ? { opacity: 0.55 } : undefined}>
              <span className="cal-item-icon">{s.booked ? <Icon name="check-circle" size={16} /> : s.past ? <Icon name="clock" size={16} /> : <span className="slot-open-dot" aria-hidden="true" />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{fmtSlot(s.slot)}</div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {s.booked ? 'Booked' : s.past ? 'Past' : 'Open for booking'}
                </div>
              </div>
              {!s.booked && !s.past && (
                <button className="link-btn" onClick={() => remove(s)} aria-label="Remove slot"><Icon name="x" size={15} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BookingRow({ b, onChanged, past }) {
  const toast = useToast();
  const cancel = () =>
    api.cancelMentorBooking(b.id)
      .then(() => api.mentorDashboard())
      .then(onChanged)
      .then(() => toast.success('Booking cancelled — the researcher was notified'))
      .catch((e) => toast.error(e.message));
  return (
    <div className="cal-item">
      <Pfp name={b.researcherName} url={imageSrc(b.researcherAvatarUrl)} size="xs" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          <Link to={`/p/${b.researcherSlug}`}>{b.researcherName}</Link>
        </div>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          {fmtSlot(b.slot)}{b.note ? ` · “${b.note}”` : ''}
        </div>
      </div>
      {b.status === 'cancelled' ? (
        <Badge tone="red">cancelled</Badge>
      ) : (
        <>
          {b.meetingUrl && !past && <a className="btn btn-sm btn-ghost" href={b.meetingUrl} target="_blank" rel="noreferrer">Join</a>}
          {!past && <button className="btn btn-sm btn-ghost" onClick={cancel}>Cancel</button>}
          {past && <Badge tone="gray">done</Badge>}
        </>
      )}
    </div>
  );
}
