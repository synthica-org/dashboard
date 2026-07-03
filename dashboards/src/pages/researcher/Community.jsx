import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Button, Pfp, EmptyState } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';
import { useRealtime } from '../../realtime.js';
import SafetyMenu from '../../components/SafetyMenu.jsx';
import { imageSrc } from '../../files.js';
import { safeHref } from '../../url.js';
import News from './News.jsx';

const ago = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
};

// The live community feed — members post questions, opportunities, and updates,
// then like and comment. The social heart of the portal.
export default function Community() {
  const [tab, setTab] = useState('feed');
  const [posts, setPosts] = useState(null);

  const load = useCallback(() => api.posts().then(setPosts).catch(() => setPosts([])), []);
  useEffect(() => { load(); }, [load]);

  // Likes and comments on your posts arrive as notifications over SSE — refresh
  // the feed so counts stay current without a manual reload. (The backend does
  // not broadcast brand-new posts, so we don't fake a live insert for those.)
  useRealtime('notification', useCallback((d) => { if (d?.type === 'post') load(); }, [load]));

  // The post APIs return the full updated post — patch it in place.
  const patch = (updated) => setPosts((cur) => (cur || []).map((p) => (p.id === updated.id ? updated : p)));
  const remove = (id) => setPosts((cur) => (cur || []).filter((p) => p.id !== id));

  return (
    <div>
      <h1 className="page-title">Community</h1>
      <p className="page-sub">Connect with researchers worldwide — share, ask, and keep up with the latest.</p>

      <div className="seg" style={{ marginBottom: '1.25rem' }}>
        <button className={`seg-btn ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>Feed</button>
        <button className={`seg-btn ${tab === 'news' ? 'active' : ''}`} onClick={() => setTab('news')}>News &amp; announcements</button>
      </div>

      {tab === 'news' ? (
        <News embedded />
      ) : !posts ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <>
          <Composer onPosted={(p) => setPosts((cur) => [p, ...(cur || [])])} />
          {posts.length === 0 ? (
            <EmptyState>No posts yet — be the first to share something with the community.</EmptyState>
          ) : (
            <div className="stack" style={{ gap: '1rem' }}>
              {posts.map((p) => <PostCard key={p.id} post={p} onChange={patch} onDeleted={remove} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Composer({ onPosted }) {
  const { user } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [text, setText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const empty = !text.trim() && !linkUrl.trim() && !imageUrl.trim();

  const pickImage = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploading(true);
    api.upload(file, 'image')
      .then((res) => setImageUrl(res.url))
      .catch((err) => toast.error(err.message))
      .finally(() => setUploading(false));
  };

  const reset = () => { setText(''); setLinkUrl(''); setImageUrl(''); setShowLink(false); };

  const submit = async () => {
    if (empty) return;
    setBusy(true);
    try {
      const post = await api.createPost({ text, linkUrl, imageUrl });
      onPosted(post);
      reset();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Pfp name={user?.name} url={imageSrc(user?.avatarUrl)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Share an opportunity or ask a question, ${user?.name?.split(' ')?.[0] || 'there'}…`}
            rows={2}
            style={{ resize: 'vertical' }}
          />
          {showLink && (
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://… (optional link)"
              style={{ marginTop: '0.4rem' }}
            />
          )}
          {imageUrl && (
            <div style={{ position: 'relative', marginTop: '0.5rem' }}>
              <img src={imageSrc(imageUrl)} alt="" style={{ width: '100%', borderRadius: 12, maxHeight: 300, objectFit: 'cover' }} />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setImageUrl('')}
                title="Remove image"
                aria-label="Remove image"
                style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', minWidth: 42, minHeight: 36 }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'space-between', marginTop: '0.5rem', gap: '0.5rem' }}>
            <div className="row" style={{ gap: '0.15rem' }}>
              <Button variant="ghost" className="btn-sm" onClick={() => setShowLink((v) => !v)}>
                <span className="icon-label"><Icon name="link" size={13} /> {showLink ? 'Remove link' : 'Add link'}</span>
              </Button>
              <Button variant="ghost" className="btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <span className="icon-label"><Icon name="image" size={13} /> {uploading ? 'Uploading…' : 'Add image'}</span>
              </Button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            </div>
            <Button className="btn-sm" disabled={busy || uploading || empty} onClick={submit}>{busy ? 'Posting…' : 'Post'}</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PostCard({ post, onChange, onDeleted }) {
  const { user } = useAuth();
  const toast = useToast();
  const [showComments, setShowComments] = useState(false);
  const [comment, setComment] = useState('');
  const isOwn = post.author.id === user?.id;

  const like = () => api.likePost(post.id).then(onChange).catch((e) => toast.error(e.message));
  const sendComment = () => {
    if (!comment.trim()) return;
    api.commentPost(post.id, comment)
      .then((p) => { onChange(p); setComment(''); setShowComments(true); })
      .catch((e) => toast.error(e.message));
  };
  const del = () => {
    if (!window.confirm('Delete this post?')) return;
    api.deletePost(post.id).then(() => onDeleted(post.id)).catch((e) => toast.error(e.message));
  };

  const link = safeHref(post.linkUrl);

  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <Pfp name={post.author.name} url={imageSrc(post.author.avatarUrl)} />
          <div>
            <Link to={`/p/${post.author.slug}`} style={{ fontWeight: 700 }}>{post.author.name}</Link>
            <div className="muted" style={{ fontSize: '0.76rem' }}>{post.author.role} · {ago(post.at)}</div>
          </div>
        </div>
        <div className="row" style={{ gap: '0.15rem' }}>
          {!isOwn && (
            <SafetyMenu
              kind="post"
              targetId={post.id}
              authorId={post.author.id}
              authorName={post.author.name}
              onBlocked={() => onDeleted(post.id)}
            />
          )}
          {post.canDelete && <button className="icon-btn icon-btn-danger" onClick={del} title="Delete post" aria-label="Delete post"><Icon name="x" size={15} /></button>}
        </div>
      </div>

      {post.text && <p style={{ margin: '0.7rem 0', whiteSpace: 'pre-wrap' }}>{post.text}</p>}
      {post.imageUrl && <img src={imageSrc(post.imageUrl)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', borderRadius: 12, maxHeight: 360, objectFit: 'cover' }} />}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="info-block" style={{ display: 'block', marginTop: '0.5rem', wordBreak: 'break-all' }}>
          <span className="icon-label"><Icon name="link" size={13} /> {post.linkUrl}</span>
        </a>
      )}

      <div className="row" style={{ marginTop: '0.7rem', gap: '1rem' }}>
        <button className={`btn btn-ghost btn-sm like-btn ${post.likedByMe ? 'on' : ''}`} onClick={like} aria-pressed={post.likedByMe}>
          <span className="icon-label"><Icon name="heart" size={14} /> {post.likeCount > 0 ? post.likeCount : ''} Like</span>
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowComments((v) => !v)}>
          <span className="icon-label"><Icon name="message-circle" size={14} /> {post.commentCount > 0 ? post.commentCount : ''} Comment</span>
        </button>
      </div>

      {showComments && (
        <div style={{ marginTop: '0.6rem' }}>
          {post.comments.length > 0 && (
            <div className="stack" style={{ marginBottom: '0.5rem' }}>
              {post.comments.map((c) => (
                <div key={c.id} className="info-block" style={{ fontSize: '0.88rem' }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div><Link to={`/p/${c.author.slug}`} style={{ fontWeight: 700 }}>{c.author.name}</Link> <span className="muted" style={{ fontSize: '0.72rem' }}>{ago(c.at)}</span></div>
                    {c.author.id !== user?.id && (
                      <SafetyMenu kind="comment" targetId={c.id} authorId={c.author.id} authorName={c.author.name} onBlocked={() => onChange({ ...post, comments: post.comments.filter((x) => x.id !== c.id) })} />
                    )}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" onKeyDown={(e) => e.key === 'Enter' && sendComment()} />
            <Button className="btn-sm" onClick={sendComment} disabled={!comment.trim()}>Send</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
