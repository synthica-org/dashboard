import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

// ⌘K / Ctrl-K global command palette: jump to any tab, project, or announcement.
export default function CommandPalette({ nav = [] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [extra, setExtra] = useState([]); // dynamic targets (projects, news)

  // Open on ⌘K / Ctrl-K; close on Esc.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load searchable targets when first opened.
  useEffect(() => {
    if (!open || extra.length) return;
    const out = [];
    const tasks = [];
    if (user?.kind === 'researcher') {
      tasks.push(api.myProjects().then((ps) => ps.forEach((p) => out.push({ label: `Project: ${p.title}`, to: `/researcher/project/${p.id}` }))).catch(() => {}));
    }
    tasks.push(api.news().then((ns) => ns.slice(0, 10).forEach((n) => out.push({ label: `News: ${n.title}`, to: user?.kind === 'editor' ? '/editor' : '/researcher' }))).catch(() => {}));
    Promise.all(tasks).then(() => setExtra(out));
  }, [open]); // eslint-disable-line

  // Live global search across people, projects, groups, and publications.
  const [results, setResults] = useState([]);
  useEffect(() => {
    const needle = q.trim();
    if (!open || needle.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.search(needle).then((r) => {
        const out = [];
        for (const p of r.people || []) out.push({ label: `Person · ${p.name}${p.role ? ` · ${p.role}` : ''}`, to: `/p/${p.slug}` });
        if (user?.kind === 'researcher') {
          for (const pr of r.projects || []) out.push({ label: `Project · ${pr.title}`, to: `/researcher/project/${pr.id}` });
          for (const g of r.groups || []) out.push({ label: `Group · ${g.name}`, to: `/researcher/groups/${g.id}` });
        }
        for (const pub of r.publications || []) out.push({ label: `Paper · ${pub.title}`, to: '/archive' });
        setResults(out);
      }).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, user?.kind]);

  const items = useMemo(() => {
    const base = nav.filter((n) => n.to).map((n) => ({ label: n.label, to: n.to }));
    const needle = q.trim().toLowerCase();
    const local = [...base, ...extra];
    const filtered = needle ? local.filter((i) => i.label.toLowerCase().includes(needle)) : local;
    // Local nav matches first, then live search results (deduped by destination).
    const seen = new Set(filtered.map((i) => i.to + i.label));
    return [...filtered, ...results.filter((r) => !seen.has(r.to + r.label))];
  }, [nav, extra, q, results]);

  useEffect(() => setActive(0), [q, open]);

  if (!open) return null;

  const choose = (i) => {
    const item = items[i];
    if (!item) return;
    setOpen(false);
    setQ('');
    navigate(item.to);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  };

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          className="cmdk-input"
          autoFocus
          placeholder="Search people, projects, groups, papers…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list">
          {items.length === 0 && <div className="cmdk-empty">No matches.</div>}
          {items.map((i, idx) => (
            <button key={i.to + i.label} className={`cmdk-item ${idx === active ? 'active' : ''}`} onMouseEnter={() => setActive(idx)} onClick={() => choose(idx)}>
              {i.label}
            </button>
          ))}
        </div>
        <div className="cmdk-foot">↑↓ navigate · ↵ open · esc close</div>
      </div>
    </div>
  );
}
