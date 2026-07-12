import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Badge, Button, Field } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';

// One row per calendar "kind". Mentor bookings (written into db.events by the
// mentors unit) surface as their own kind; `dot` maps to the swatch colour under
// each day cell, and anything unrecognised falls back to a generic event so the
// calendar never breaks on a new event type.
const KIND_META = {
  paper: { icon: 'file-text', tone: 'gold', label: 'Paper', dot: 'paper' },
  task: { icon: 'check-circle', tone: 'blue', label: 'Task', dot: 'task' },
  event: { icon: 'calendar', tone: 'gray', label: 'Event', dot: 'event' },
  workshop: { icon: 'graduation-cap', tone: 'blue', label: 'Workshop', dot: 'event' },
  meetup: { icon: 'users', tone: 'blue', label: 'Meetup', dot: 'event' },
  mentor: { icon: 'video', tone: 'green', label: 'Mentor call', dot: 'mentor' },
  booking: { icon: 'video', tone: 'green', label: 'Mentor call', dot: 'mentor' },
  pathway: { icon: 'compass', tone: 'gray', label: 'Pathway', dot: 'pathway' },
};
const metaFor = (kind) => KIND_META[kind] || KIND_META.event;
const iso = (d) => d.toISOString().slice(0, 10);

// Legend swatches mirror the dot colours shown under each day cell.
const LEGEND = [
  { dot: 'task', label: 'Tasks' },
  { dot: 'paper', label: 'Deadlines' },
  { dot: 'event', label: 'Events' },
  { dot: 'mentor', label: 'Mentor calls' },
  { dot: 'pathway', label: 'Pathway' },
];

// Shared calendar — one place that aggregates everything dated that concerns
// you: project/group/chapter events & deadlines, project task due dates, your
// pathway steps, and mentor bookings. Month grid + an upcoming list.
export default function Calendar() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState(null); // null = still loading
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(iso(new Date()));
  const [open, setOpen] = useState(false);

  const load = useCallback(() => api.calendar().then(setItems).catch(() => setItems([])), []);
  useEffect(() => { load(); }, [load]);

  const list = items || [];
  const byDate = useMemo(() => {
    const m = {};
    for (const it of list) (m[it.date] = m[it.date] || []).push(it);
    return m;
  }, [list]);

  // Build the month grid (six weeks, weeks starting Monday).
  const cells = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const today = iso(new Date());
  const upcoming = list.filter((it) => it.date >= today).slice(0, 8);
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  const remove = (it) =>
    api.deleteEvent(it.id).then(() => { toast.success('Removed from the calendar'); load(); }).catch((e) => toast.error(e.message));

  // Optimistic RSVP toggle on gatherings.
  const rsvp = (it) =>
    api.rsvpEvent(it.eventId, !it.going)
      .then((r) => setItems((cur) => (cur || []).map((x) => (x.eventId === it.eventId && x.kind === it.kind ? { ...x, going: r.going, rsvpCount: r.rsvpCount } : x))))
      .catch((e) => toast.error(e.message));

  if (items === null) return <div className="page-loading">Loading your calendar…</div>;

  return (
    <div>
      <div className="card-row" style={{ marginBottom: '0.25rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Calendar</h1>
        <Button onClick={() => setOpen((o) => !o)}>{open ? 'Close' : '+ Add to calendar'}</Button>
      </div>
      <p className="page-sub">Project & group deadlines, task due dates, your pathway, and mentor calls — all in one place.</p>

      {open && <EventForm user={user} onAdded={(msg) => { setOpen(false); load(); toast.success(msg); }} />}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', alignItems: 'start' }}>
        <Card className="cal-card">
          <div className="card-row" style={{ marginBottom: '0.75rem' }}>
            <strong style={{ fontSize: '1.05rem' }}>{monthLabel}</strong>
            <span className="row" style={{ gap: '0.3rem' }}>
              <button className="cal-nav" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
              <button className="cal-nav" onClick={() => { setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setSelected(today); }}>Today</button>
              <button className="cal-nav" onClick={() => shift(1)} aria-label="Next month">›</button>
            </span>
          </div>
          <div className="cal-grid cal-head">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="cal-grid">
            {cells.map((d) => {
              const key = iso(d);
              const inMonth = d.getMonth() === month.getMonth();
              const dayItems = byDate[key] || [];
              return (
                <button
                  key={key}
                  className={`cal-day ${inMonth ? '' : 'dim'} ${key === today ? 'today' : ''} ${key === selected ? 'sel' : ''}`}
                  onClick={() => setSelected(key)}
                  aria-label={`${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${dayItems.length ? `, ${dayItems.length} item${dayItems.length === 1 ? '' : 's'}` : ''}`}
                >
                  <span className="cal-num">{d.getDate()}</span>
                  {dayItems.length > 0 && (
                    <span className="cal-dots">
                      {dayItems.slice(0, 3).map((it, i) => <i key={i} className={`cal-dot dot-${metaFor(it.kind).dot}`} />)}
                      {dayItems.length > 3 && <em>+{dayItems.length - 3}</em>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="cal-legend">
            {LEGEND.map((l) => <span key={l.dot} className="cal-legend-item"><i className={`cal-dot dot-${l.dot}`} />{l.label}</span>)}
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <div className="muted" style={{ marginBottom: '0.4rem' }}>
              {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            {(byDate[selected] || []).length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nothing scheduled this day.</p>
            ) : (
              <div className="stack">
                {byDate[selected].map((it) => <CalRow key={it.id} it={it} onRemove={remove} onRsvp={rsvp} />)}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <h3 style={{ marginTop: 0 }}>Coming up</h3>
          {upcoming.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nothing on the horizon. Enjoy the calm.</p>
          ) : (
            <div className="stack">
              {upcoming.map((it) => <CalRow key={it.id} it={it} onRemove={remove} onRsvp={rsvp} showDate />)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CalRow({ it, onRemove, onRsvp, showDate }) {
  const meta = metaFor(it.kind);
  const past = it.date < new Date().toISOString().slice(0, 10);
  // Task/paper/pathway deadlines read as "overdue" when past; gatherings &
  // bookings don't — a past meetup is simply done, not overdue.
  const isDeadline = it.kind === 'task' || it.kind === 'paper' || it.kind === 'pathway';
  const overdue = past && isDeadline;
  return (
    <div className="cal-item">
      <span className="guide-ico cal-item-icon" aria-hidden="true"><Icon name={meta.icon} size={17} /></span>
      <div className="cal-item-body">
        <div className="cal-item-title">{it.title}</div>
        <div className="muted cal-item-meta">
          {showDate && <>{new Date(`${it.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · </>}
          {it.context}{it.byName ? ` · ${meta.label === 'Mentor call' ? 'with' : 'set by'} ${it.byName}` : ''}
          {it.rsvpable && it.rsvpCount > 0 && ` · ${it.rsvpCount} going`}
        </div>
      </div>
      <div className="cal-item-actions">
        {it.rsvpable && onRsvp && (
          <button className={`btn btn-sm ${it.going ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onRsvp(it)}>
            {it.going ? <><Icon name="check" size={14} /> Going</> : 'RSVP'}
          </button>
        )}
        <Badge tone={overdue ? 'red' : meta.tone}>{overdue ? 'overdue' : meta.label}</Badge>
        {it.canDelete && <button className="icon-btn icon-btn-danger" onClick={() => onRemove(it)} aria-label="Delete" title="Delete"><Icon name="x" size={15} /></button>}
      </div>
    </div>
  );
}

// Add an item to the calendar, scoped to one of your projects or your chapter.
// Members can post gatherings (event/workshop/meetup, RSVP-able) on any project
// they're in; the lead of a project — and a chapter leader — can additionally
// set task/paper deadlines. (Group events are created from the group page; they
// still appear on this calendar.)
function EventForm({ user, onAdded }) {
  const toast = useToast();
  const [targets, setTargets] = useState(null); // [{ value, label, lead }] | null while loading
  const [f, setF] = useState({ title: '', type: 'event', dueAt: '', target: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // api.chapter() resolves only for the chapter you lead (404 otherwise), so a
    // resolved chapter is always a lead target.
    Promise.allSettled([api.myProjects(), api.chapter()]).then(([pr, ch]) => {
      const t = [];
      if (pr.status === 'fulfilled')
        for (const p of pr.value || []) t.push({ value: `project:${p.id}`, label: p.title, lead: p.leadId === user.id });
      if (ch.status === 'fulfilled' && ch.value?.id) t.push({ value: `chapter:${ch.value.id}`, label: `${ch.value.name} (chapter)`, lead: true });
      setTargets(t);
      if (t[0]) setF((x) => ({ ...x, target: t[0].value }));
    });
  }, [user.id]);

  const current = (targets || []).find((t) => t.value === f.target);
  // Deadlines (task/paper) require lead rights on the chosen target; gatherings
  // don't. If the picked target can't take a deadline, fall back to an event.
  const canSetDeadline = !!current?.lead;
  const GATHERINGS = ['event', 'workshop', 'meetup'];
  const effectiveType = (!canSetDeadline && !GATHERINGS.includes(f.type)) ? 'event' : f.type;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const [kind, id] = f.target.split(':');
    try {
      await api.addEvent({
        title: f.title,
        type: effectiveType,
        dueAt: f.dueAt,
        projectId: kind === 'project' ? id : undefined,
        chapterId: kind === 'chapter' ? id : undefined,
      });
      const isDeadline = effectiveType === 'task' || effectiveType === 'paper';
      onAdded(isDeadline ? 'Deadline set — your team has been notified' : 'Event added — everyone in it is notified');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  if (targets === null) return <Card style={{ marginBottom: '1rem' }}><div className="skeleton skeleton-card" /></Card>;
  if (!targets.length) {
    return <Card style={{ marginBottom: '1rem' }}><p className="muted" style={{ margin: 0 }}>Join a project or lead a chapter and you'll be able to add shared events here.</p></Card>;
  }
  return (
    <Card style={{ marginBottom: '1rem' }}>
      <form onSubmit={submit}>
        <Field label="What's happening?"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Team sync · Draft due · Stats workshop" required /></Field>
        <div className="grid grid-3">
          <Field label="For">
            <select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
              {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={effectiveType} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="event">Event</option>
              <option value="workshop">Workshop</option>
              <option value="meetup">Meetup</option>
              {canSetDeadline && <option value="task">Task deadline</option>}
              {canSetDeadline && <option value="paper">Paper deadline</option>}
            </select>
          </Field>
          <Field label="Date"><input type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} required /></Field>
        </div>
        <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add to calendar'}</Button>
        <span className="muted" style={{ marginLeft: '0.6rem', fontSize: '0.8rem' }}>
          {canSetDeadline ? 'Everyone in it sees the item and gets a notification.' : 'Members can post events; only the lead sets task/paper deadlines.'}
        </span>
      </form>
    </Card>
  );
}
