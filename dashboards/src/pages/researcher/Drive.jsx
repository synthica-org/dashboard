import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { EmptyState } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { embedSrc, fileMeta } from '../../files.js';

// Synthica Drive — a real file-browser feel over everything you're working on.
// Folders derive from your projects (shared links) + a "My papers" folder built
// from your journal submissions and archived papers. Toolbar: back, path bar,
// search, grid/list toggle. Click a file to preview (PDFs/Drive) or open it.
export default function Drive() {
  const [data, setData] = useState(null); // { projects, subs, pubs } | null while loading
  const [open, setOpen] = useState(null); // open folder id
  const [view, setView] = useState(() => localStorage.getItem('synthica.drive.view') || 'grid');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    Promise.allSettled([api.myProjects(), api.mySubmissions(), api.myPublications()]).then(([pr, su, pu]) => {
      setData({
        projects: pr.status === 'fulfilled' ? pr.value : [],
        subs: su.status === 'fulfilled' ? su.value : [],
        pubs: pu.status === 'fulfilled' ? pu.value : [],
      });
    });
  }, []);

  const setViewMode = (v) => { setView(v); try { localStorage.setItem('synthica.drive.view', v); } catch { /* ignore */ } };

  // Build the folder tree from live data — nothing to manage by hand. "My
  // papers" gathers every revision of each submission plus archived papers.
  const folders = useMemo(() => {
    if (!data) return [];
    const f = data.projects.map((p) => ({
      id: p.id,
      name: p.title,
      sub: p.category || 'Project',
      files: (p.links || []).map((l) => ({ id: l.id, name: l.label || l.url, url: l.url, at: l.at })),
    }));
    const paperFiles = [
      ...data.subs.flatMap((s) =>
        (s.revisions || []).map((r) => ({ id: `${s.id}v${r.version}`, name: `${s.title} (v${r.version})`, url: r.url, at: r.at }))),
      ...data.pubs.filter((p) => p.pdfUrl).map((p) => ({ id: p.id, name: p.title, url: p.pdfUrl, at: p.publishedAt })),
    ];
    if (paperFiles.length) f.push({ id: 'papers', name: 'My papers', sub: 'Submissions & archive', files: paperFiles });
    return f;
  }, [data]);

  const folder = folders.find((x) => x.id === open);
  const needle = q.trim().toLowerCase();
  const visibleFiles = folder
    ? folder.files.filter((file) => !needle || file.name.toLowerCase().includes(needle))
    : null;
  const visibleFolders = !folder
    ? folders.filter((fo) => !needle || fo.name.toLowerCase().includes(needle))
    : null;
  const totalFiles = useMemo(() => folders.reduce((n, fo) => n + fo.files.length, 0), [folders]);

  const goRoot = () => { setOpen(null); setQ(''); };
  const openFile = (file) => {
    if (embedSrc(file.url)) setPreview(file);
    else window.open(file.url, '_blank', 'noopener');
  };

  if (data === null) return <div className="page-loading">Loading your files…</div>;

  return (
    <div>
      <h1 className="page-title">Synthica Drive</h1>
      <p className="page-sub">Every link your teams have shared plus your own papers, organized into folders automatically.</p>

      <div className="fm">
        {/* toolbar */}
        <div className="fm-toolbar">
          <button className="fm-btn" disabled={!folder} onClick={goRoot} title="Back" aria-label="Back"><Icon name="arrow-left" size={15} /></button>
          <div className="fm-path">
            <button className="fm-crumb icon-label" onClick={goRoot}><Icon name="folder-open" size={13} /> Drive</button>
            {folder && (
              <>
                <span className="fm-sep">/</span>
                <span className="fm-crumb fm-crumb-here icon-label"><Icon name="folder" size={13} /> {folder.name}</span>
              </>
            )}
          </div>
          <input className="fm-search" placeholder={folder ? 'Search this folder' : 'Search folders'} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg fm-view">
            <button type="button" className={`seg-btn ${view === 'grid' ? 'on' : ''}`} onClick={() => setViewMode('grid')} title="Grid view" aria-label="Grid view"><Icon name="grid" size={15} /></button>
            <button type="button" className={`seg-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setViewMode('list')} title="List view" aria-label="List view"><Icon name="list" size={15} /></button>
          </div>
        </div>

        {/* body */}
        <div className="fm-body">
          {!folder ? (
            visibleFolders.length === 0 ? (
              <EmptyState>{q ? 'No folders match your search.' : 'No folders yet — join a project or submit a paper and they\'ll show up here.'}</EmptyState>
            ) : view === 'grid' ? (
              <div className="drive-grid">
                {visibleFolders.map((fo) => (
                  <button key={fo.id} className="drive-tile drive-folder" onDoubleClick={() => setOpen(fo.id)} onClick={() => setOpen(fo.id)}>
                    <span className="drive-icon"><Icon name="folder" size={30} /></span>
                    <span className="drive-name">{fo.name}</span>
                    <span className="muted drive-sub">{fo.files.length} item{fo.files.length === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="fm-list">
                <div className="fm-row fm-row-head"><span>Name</span><span>Kind</span><span>Items</span><span /></div>
                {visibleFolders.map((fo) => (
                  <button key={fo.id} className="fm-row" onClick={() => setOpen(fo.id)}>
                    <span className="fm-name"><Icon name="folder" size={14} /> {fo.name}</span>
                    <span className="muted">Folder · {fo.sub}</span>
                    <span className="muted">{fo.files.length}</span>
                    <span className="muted"><Icon name="chevron-right" size={14} /></span>
                  </button>
                ))}
              </div>
            )
          ) : visibleFiles.length === 0 ? (
            <EmptyState>{q ? 'No files match your search.' : 'Nothing in this folder yet — add links from the project page and they\'ll appear here.'}</EmptyState>
          ) : view === 'grid' ? (
            <div className="drive-grid">
              {visibleFiles.map((file) => {
                const meta = fileMeta(file.url);
                return (
                  <button key={file.id} className="drive-tile" title={file.url} onClick={() => openFile(file)}>
                    <span className="drive-icon"><Icon name={meta.icon} size={30} /></span>
                    <span className="drive-name">{file.name}</span>
                    <span className="muted drive-sub">{meta.kind}{embedSrc(file.url) ? ' · preview' : ''}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="fm-list">
              <div className="fm-row fm-row-head"><span>Name</span><span>Kind</span><span>Added</span><span /></div>
              {visibleFiles.map((file) => {
                const meta = fileMeta(file.url);
                return (
                  <button key={file.id} className="fm-row" onClick={() => openFile(file)} title={file.url}>
                    <span className="fm-name"><Icon name={meta.icon} size={14} /> {file.name}</span>
                    <span className="muted">{meta.kind}</span>
                    <span className="muted">{file.at ? new Date(file.at).toLocaleDateString() : '—'}</span>
                    <span className="muted"><Icon name={embedSrc(file.url) ? 'eye' : 'external-link'} size={14} /></span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* status bar */}
        <div className="fm-status">
          {folder
            ? `${visibleFiles.length} item${visibleFiles.length === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''} · ${folder.sub}`
            : `${visibleFolders.length} folder${visibleFolders.length === 1 ? '' : 's'} · ${totalFiles} file${totalFiles === 1 ? '' : 's'} · synced from your projects & papers`}
        </div>
      </div>

      {preview && (
        <div className="drive-overlay" onClick={() => setPreview(null)}>
          <div className="drive-preview" onClick={(e) => e.stopPropagation()}>
            <div className="card-row" style={{ marginBottom: '0.6rem' }}>
              <strong className="icon-label" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Icon name={fileMeta(preview.url).icon} size={15} /> {preview.name}
              </strong>
              <span className="row" style={{ flexShrink: 0 }}>
                <a className="btn btn-ghost btn-sm" href={preview.url} target="_blank" rel="noreferrer"><span className="icon-label">Open <Icon name="external-link" size={12} /></span></a>
                <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)} aria-label="Close preview"><Icon name="x" size={14} /></button>
              </span>
            </div>
            <iframe className="drive-frame" src={embedSrc(preview.url)} title={preview.name} loading="lazy" />
          </div>
        </div>
      )}
    </div>
  );
}
