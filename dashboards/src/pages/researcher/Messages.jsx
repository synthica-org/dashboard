import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Button, Pfp, EmptyState, Badge } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import SafetyMenu from '../../components/SafetyMenu.jsx';
import { imageSrc } from '../../files.js';
import { useRealtime } from '../../realtime.js';

const ago = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString();
};

// Direct messages — a conversation list beside the open thread, updating live
// over SSE as new messages arrive.
export default function Messages() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [convos, setConvos] = useState(null);

  const loadConvos = useCallback(() => api.conversations().then(setConvos).catch(() => setConvos([])), []);
  useEffect(() => { loadConvos(); }, [loadConvos]);
  useRealtime('message', loadConvos); // new message anywhere → refresh the list

  if (!convos) return <div className="page-loading">Loading…</div>;

  const totalUnread = convos.reduce((n, c) => n + (c.unread || 0), 0);

  return (
    <div>
      <h1 className="page-title">Messages</h1>
      <p className="page-sub">
        Direct messages with members. Find people in the directory and start a conversation.
        {totalUnread > 0 && <> · <strong>{totalUnread} unread</strong></>}
      </p>
      <div className="dm-layout">
        <Card className="dm-list">
          {convos.length === 0 ? (
            <EmptyState>No conversations yet — message someone from their profile or the <Link to="/researcher/people">People directory</Link>.</EmptyState>
          ) : (
            convos.map((c) => (
              <button
                key={c.user.id}
                className={`dm-convo ${userId === c.user.id ? 'active' : ''}`}
                onClick={() => navigate(`/researcher/messages/${c.user.id}`)}
              >
                <Pfp name={c.user.name} url={imageSrc(c.user.avatarUrl)} size="xs" />
                <span className="dm-convo-body">
                  <span className="dm-convo-name">{c.user.name}{c.unread > 0 && <Badge tone="blue">{c.unread}</Badge>}</span>
                  <span className="dm-convo-last" style={c.unread > 0 ? { fontWeight: 700, color: 'var(--heading)' } : undefined}>{c.mine ? 'You: ' : ''}{c.lastMessage}</span>
                </span>
                <span className="dm-convo-time">{ago(c.lastAt)}</span>
              </button>
            ))
          )}
        </Card>

        <Card className="dm-thread-card">
          {userId ? (
            <Thread key={userId} userId={userId} onSent={loadConvos} onRead={loadConvos} />
          ) : (
            <EmptyState>Select a conversation to start chatting.</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}

function Thread({ userId, onSent, onRead }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const endRef = useRef(null);
  const navigate = useNavigate();

  // Loading the thread marks the other person's messages as read on the server,
  // so refresh the conversation list afterwards to clear the unread badge.
  const load = useCallback(
    () => api.thread(userId).then((d) => { setData(d); onRead?.(); }).catch(() => setData(null)),
    [userId, onRead],
  );
  useEffect(() => { setData(null); load(); }, [load]);

  // Live: when a message arrives from the person we're chatting with, reload.
  useRealtime('message', useCallback((d) => { if (d.from === userId) load(); }, [userId, load]));

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [data]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const msg = await api.sendMessage(userId, body);
      setData((d) => (d ? { ...d, messages: [...d.messages, msg] } : d));
      setText('');
      onSent?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!data) return <div className="page-loading" style={{ minHeight: 200 }}>Loading…</div>;

  return (
    <div className="dm-thread">
      <div className="dm-thread-head">
        <Link to={`/p/${data.user.slug}`} aria-label={`${data.user.name}'s profile`}><Pfp name={data.user.name} url={imageSrc(data.user.avatarUrl)} size="xs" /></Link>
        <div style={{ minWidth: 0 }}>
          <Link to={`/p/${data.user.slug}`} style={{ fontWeight: 700 }}>{data.user.name}</Link>
          {data.user.role && <div className="muted" style={{ fontSize: '0.74rem' }}>{data.user.role}</div>}
        </div>
        <span style={{ marginLeft: 'auto' }}>
          <SafetyMenu kind="profile" targetId={data.user.id} authorId={data.user.id} authorName={data.user.name} onBlocked={() => navigate('/researcher/messages')} />
        </span>
      </div>
      <div className="dm-messages">
        {data.messages.length === 0 && <p className="muted" style={{ textAlign: 'center', marginTop: '1rem' }}>No messages yet — say hello 👋</p>}
        {data.messages.map((m) => (
          <div key={m.id} className={`dm-bubble ${m.mine ? 'mine' : ''}`}>
            <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
            <span className="dm-bubble-time">{ago(m.at)}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="dm-compose">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" onKeyDown={(e) => e.key === 'Enter' && send()} />
        <Button disabled={busy || !text.trim()} onClick={send}>Send</Button>
      </div>
    </div>
  );
}
