import { api } from '../api.js';
import { useToast } from './toast.jsx';
import Icon from './Icon.jsx';

// A compact "⋯" overflow menu for user-generated content: report it, or block
// its author. Native <details> handles open/close without outside-click glue.
// `kind` is the report type ('post' | 'comment' | 'message' | 'profile').
export default function SafetyMenu({ kind, targetId, authorId, authorName, onBlocked, align = 'right' }) {
  const toast = useToast();
  const close = (e) => { const d = e.currentTarget.closest('details'); if (d) d.open = false; };

  const report = async (e) => {
    close(e);
    const reason = window.prompt(`Report this ${kind}? Add a reason (optional):`, '');
    if (reason === null) return; // cancelled
    try { await api.report(kind, targetId, reason || ''); toast.success('Reported — our team will take a look.'); }
    catch (err) { toast.error(err.message); }
  };

  const block = async (e) => {
    close(e);
    if (!authorId) return;
    if (!window.confirm(`Block ${authorName || 'this member'}? You won't see their posts, comments, or messages, and they can't message you.`)) return;
    try { await api.blockUser(authorId); toast.success(`Blocked ${authorName || 'member'}`); onBlocked?.(authorId); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <details className="safety-menu">
      <summary className="safety-menu-trigger" title="More" aria-label="More options"><Icon name="more-horizontal" size={16} /></summary>
      <div className={`safety-menu-pop ${align === 'left' ? 'left' : ''}`}>
        <button type="button" onClick={report}><span className="icon-label"><Icon name="flag" size={14} /> Report {kind}</span></button>
        {authorId && <button type="button" onClick={block}><span className="icon-label"><Icon name="ban" size={14} /> Block {authorName || 'member'}</span></button>}
      </div>
    </details>
  );
}
