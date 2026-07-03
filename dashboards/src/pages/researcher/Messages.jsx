import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Button, Pfp, EmptyState, Badge } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
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

// Reaction emojis are message *content* (heart, thumbs-up, joy, surprise, sad,
// angry, fire, clap) — kept as escapes so no raw emoji glyphs live in the UI code.
const EMOJI_OPTIONS = ['\u2764\uFE0F', '\u{1F44D}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F525}', '\u{1F44F}'];

// Render text with clickable links
const renderText = (text) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^\[\]`]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => 
    urlRegex.test(part) 
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="msg-link">{part}</a>
      : part
  );
};

// Direct messages — enhanced with reactions, replies, edit, delete, forward
export default function Messages() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [convos, setConvos] = useState(null);

  const loadConvos = useCallback(() => api.conversations().then(setConvos).catch(() => setConvos([])), []);
  useEffect(() => { loadConvos(); }, [loadConvos]);
  useRealtime('message', loadConvos);

  if (!convos) return <div className="page-loading">Loading…</div>;

  return (
    <div>
      <h1 className="page-title">Messages</h1>
      <p className="page-sub">Direct messages with members. Find people in the directory and start a conversation.</p>
      <div className="dm-layout">
        <Card className="dm-list">
          {convos.length === 0 ? (
            <p className="muted" style={{ padding: '0.5rem' }}>No conversations yet — message someone from their profile or the People directory.</p>
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
                  <span className="dm-convo-last">{c.mine ? 'You: ' : ''}{c.lastMessage}</span>
                </span>
                <span className="dm-convo-time">{ago(c.lastAt)}</span>
              </button>
            ))
          )}
        </Card>

        <Card className="dm-thread-card">
          {userId ? <Thread userId={userId} onSent={loadConvos} /> : <EmptyState>Select a conversation to start chatting.</EmptyState>}
        </Card>
      </div>
    </div>
  );
}

function Thread({ userId, onSent }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [showReactionPicker, setShowReactionPicker] = useState(null);
  const [showForwardModal, setShowForwardModal] = useState(null);
  const [forwardTargets, setForwardTargets] = useState([]);
  const toast = useToast();
  const endRef = useRef(null);
  const reactionPickerRef = useRef(null);

  const navigate = useNavigate();
  const load = useCallback(() => api.thread(userId).then(setData).catch(() => setData(null)), [userId]);
  useEffect(() => { setData(null); load(); }, [load]);

  // Live updates
  useRealtime('message', useCallback((d) => { if (d.from === userId) load(); }, [userId, load]));
  useRealtime('message_edited', useCallback((d) => {
    setData(prev => prev ? {
      ...prev,
      messages: prev.messages.map(m => m.id === d.messageId ? { ...m, text: d.text, isEdited: true } : m)
    } : prev);
  }, []));
  useRealtime('message_deleted', useCallback((d) => {
    setData(prev => prev ? {
      ...prev,
      messages: prev.messages.map(m => m.id === d.messageId ? { ...m, text: '[deleted]', isDeleted: true } : m)
    } : prev);
  }, []));
  useRealtime('message_reaction', useCallback((d) => {
    setData(prev => prev ? {
      ...prev,
      messages: prev.messages.map(m => m.id === d.messageId ? { ...m, reactions: d.reactions } : m)
    } : prev);
  }, []));

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [data]);

  // Close reaction picker on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target)) {
        setShowReactionPicker(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load forward targets
  useEffect(() => {
    if (showForwardModal) {
      api.forwardTargets().then(setForwardTargets).catch(() => setForwardTargets([]));
    }
  }, [showForwardModal]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const opts = {};
      if (replyingTo) {
        opts.replyTo = replyingTo.id;
        opts.replyToContent = replyingTo.text;
        opts.replyToSender = replyingTo.mine ? 'You' : data.user.name;
        opts.replyToType = 'text';
      }
      const msg = await api.sendMessage(userId, text, opts);
      setData((d) => (d ? { ...d, messages: [...d.messages, msg] } : d));
      setText('');
      setReplyingTo(null);
      onSent?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const startEdit = (msg) => {
    setEditingId(msg.id);
    setEditText(msg.text);
  };

  const saveEdit = async (msgId) => {
    if (!editText.trim()) return;
    try {
      await api.editMessage(msgId, editText);
      setData(prev => prev ? {
        ...prev,
        messages: prev.messages.map(m => m.id === msgId ? { ...m, text: editText, isEdited: true } : m)
      } : prev);
      setEditingId(null);
      setEditText('');
    } catch (e) { toast.error(e.message); }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleDelete = async (msgId) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      await api.deleteMessage(msgId);
      setData(prev => prev ? {
        ...prev,
        messages: prev.messages.map(m => m.id === msgId ? { ...m, text: '[deleted]', isDeleted: true } : m)
      } : prev);
      toast.success('Message deleted');
    } catch (e) { toast.error(e.message); }
  };

  const handleReaction = async (msgId, emoji) => {
    try {
      const reactions = await api.toggleReaction(msgId, emoji);
      setData(prev => prev ? {
        ...prev,
        messages: prev.messages.map(m => m.id === msgId ? { ...m, reactions } : m)
      } : prev);
      setShowReactionPicker(null);
    } catch (e) { toast.error(e.message); }
  };

  const handleForward = async (msgId, toUserId) => {
    try {
      await api.forwardMessage(msgId, toUserId);
      setShowForwardModal(null);
      toast.success('Message forwarded');
    } catch (e) { toast.error(e.message); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!data) return <div className="page-loading" style={{ minHeight: 200 }}>Loading…</div>;

  return (
    <div className="dm-thread">
      <div className="dm-thread-head">
        <Pfp name={data.user.name} url={imageSrc(data.user.avatarUrl)} size="xs" />
        <Link to={`/p/${data.user.slug}`} style={{ fontWeight: 700 }}>{data.user.name}</Link>
        <span className="muted" style={{ fontSize: '0.78rem' }}>{data.user.role}</span>
        <span style={{ marginLeft: 'auto' }}>
          <SafetyMenu kind="profile" targetId={data.user.id} authorId={data.user.id} authorName={data.user.name} onBlocked={() => navigate('/researcher/messages')} />
        </span>
      </div>

      <div className="dm-messages">
        {data.messages.length === 0 && <p className="muted" style={{ textAlign: 'center', marginTop: '1rem' }}>No messages yet — say hello!</p>}
        {data.messages.map((m) => (
          <div key={m.id} className={`dm-bubble-wrap ${m.mine ? 'mine' : ''}`}>
            {m.replyToId && (
              <div className="dm-reply-preview">
                <span className="dm-reply-sender">{m.replyToSender}:</span>
                <span className="dm-reply-text">{m.replyToContent || 'Media'}</span>
              </div>
            )}
            <div className={`dm-bubble ${m.mine ? 'mine' : ''} ${m.isDeleted ? 'deleted' : ''}`}>
              {m.isForwarded && <span className="dm-forwarded-badge">Forwarded</span>}
              
              {m.isDeleted ? (
                <span className="dm-deleted-text">{m.text}</span>
              ) : editingId === m.id ? (
                <div className="dm-edit-form">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="dm-edit-input"
                    autoFocus
                  />
                  <div className="dm-edit-actions">
                    <button onClick={() => saveEdit(m.id)} className="dm-btn-save">Save</button>
                    <button onClick={cancelEdit} className="dm-btn-cancel">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="dm-bubble-content">
                    <span className="dm-bubble-text">{renderText(m.text)}</span>
                    {m.isEdited && <span className="dm-edited-mark">(edited)</span>}
                  </div>
                  
                  {/* Message status */}
                  <div className="dm-bubble-status">
                    <span className="dm-bubble-time">{ago(m.at)}</span>
                    {m.mine && (
                      <span className="dm-status-icons">
                        {m.read || m.delivered ? <Icon name="check-double" size={13} /> : <Icon name="check" size={12} />}
                      </span>
                    )}
                  </div>
                  
                  {/* Reactions */}
                  {Object.keys(m.reactions || {}).length > 0 && (
                    <div className="dm-reactions">
                      {Object.entries(m.reactions).map(([emoji, users]) => (
                        <button key={emoji} className="dm-reaction" onClick={() => handleReaction(m.id, emoji)}>
                          {emoji} <span>{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Message actions */}
                  <div className="dm-bubble-actions">
                    <button onClick={() => setReplyingTo(m)} title="Reply" aria-label="Reply"><Icon name="reply" size={14} /></button>
                    <button onClick={() => setShowReactionPicker(showReactionPicker === m.id ? null : m.id)} title="React" aria-label="React"><Icon name="smile" size={14} /></button>
                    {m.mine && <button onClick={() => startEdit(m)} title="Edit" aria-label="Edit"><Icon name="pen" size={14} /></button>}
                    {m.mine && <button onClick={() => handleDelete(m.id)} title="Delete" aria-label="Delete"><Icon name="trash" size={14} /></button>}
                    <button onClick={() => setShowForwardModal(m)} title="Forward" aria-label="Forward"><Icon name="send" size={14} /></button>
                  </div>
                  
                  {/* Reaction picker */}
                  {showReactionPicker === m.id && (
                    <div className="dm-reaction-picker" ref={reactionPickerRef}>
                      {EMOJI_OPTIONS.map(emoji => (
                        <button key={emoji} onClick={() => handleReaction(m.id, emoji)}>{emoji}</button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Reply indicator */}
      {replyingTo && (
        <div className="dm-reply-indicator">
          <div className="dm-reply-info">
            <span>Replying to {replyingTo.mine ? 'yourself' : data.user.name}</span>
            <span className="dm-reply-content">{replyingTo.text?.slice(0, 50)}{replyingTo.text?.length > 50 ? '...' : ''}</span>
          </div>
          <button onClick={() => setReplyingTo(null)} className="dm-reply-close" aria-label="Cancel reply"><Icon name="x" size={14} /></button>
        </div>
      )}

      <div className="dm-compose">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a message… (Enter to send, Shift+Enter for new line)"
          className="dm-compose-input"
          rows={1}
        />
        <Button disabled={busy || !text.trim()} onClick={send}>Send</Button>
      </div>

      {/* Forward Modal */}
      {showForwardModal && (
        <div className="dm-modal-overlay" onClick={() => setShowForwardModal(null)}>
          <div className="dm-modal" onClick={e => e.stopPropagation()}>
            <h3>Forward Message</h3>
            <input
              type="text"
              placeholder="Search contacts..."
              className="dm-modal-search"
              autoFocus
            />
            <div className="dm-modal-list">
              {forwardTargets.map(u => (
                <button key={u.id} className="dm-modal-item" onClick={() => handleForward(showForwardModal.id, u.id)}>
                  <Pfp name={u.name} size="xs" />
                  <span>{u.name}</span>
                </button>
              ))}
            </div>
            <button className="dm-modal-close" onClick={() => setShowForwardModal(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
