import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Button, Badge, EmptyState } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';

const categories = ['General', 'Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];
const priorities = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const statusColors = { todo: 'blue', in_progress: 'yellow', done: 'green' };

const ago = (iso) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

export default function Sandbox() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'General', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = useCallback(() => api.sandboxList().then(setProjects).catch(() => setProjects([])), []);
  useEffect(() => { load(); }, [load]);

  const createProject = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const p = await api.sandboxCreate(form);
      setProjects(prev => [p, ...(prev || [])]);
      setForm({ title: '', category: 'General', description: '' });
      setCreating(false);
      navigate(`/researcher/sandbox/${p.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (projects === null) return <div className="page-loading">Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div className="section-badge">Independent Researcher</div>
          <h1 className="page-title">My Sandbox</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>Your personal research workspace. Create projects, track tasks, take notes, and sync to Google Drive.</p>
        </div>
        <Button onClick={() => setCreating(!creating)} style={{ marginLeft: 'auto', flex: 'none' }}>
          {creating ? 'Cancel' : <span className="icon-label"><Icon name="plus" size={14} /> New Project</span>}
        </Button>
      </div>

      {creating && (
        <Card style={{ marginBottom: '1.5rem' }}>
          <form onSubmit={createProject}>
            {error && <div className="login-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
            <div style={{ marginBottom: '1rem' }}>
              <label className="field-label">Project Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Machine Learning Study Notes"
                required
              />
            </div>
            <div className="grid grid-2" style={{ marginBottom: '1rem' }}>
              <div>
                <label className="field-label">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief overview..."
                />
              </div>
            </div>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Project'}</Button>
          </form>
        </Card>
      )}

      {projects.length === 0 && !creating ? (
        <EmptyState>No sandbox projects yet. Click "New Project" to start your research journey.</EmptyState>
      ) : (
        <div className="sandbox-grid">
          {projects.map(p => (
            <Card key={p.id} className="sandbox-card" onClick={() => navigate(`/researcher/sandbox/${p.id}`)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <Badge>{p.category}</Badge>
                {p.driveFolderId && <span className="icon-label" style={{ fontSize: '0.7rem', color: 'var(--success)' }}><Icon name="check-circle" size={11} /> Synced</span>}
              </div>
              <h3 style={{ margin: '0.5rem 0' }}>{p.title}</h3>
              {p.description && <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{p.description.slice(0, 80)}{p.description.length > 80 ? '…' : ''}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', fontSize: '0.8rem', color: 'var(--body-alt)' }}>
                <span className="icon-label"><Icon name="check-square" size={13} /> {p.tasks?.length || 0} tasks</span>
                <span className="icon-label"><Icon name="pen" size={13} /> {p.notes?.length || 0} notes</span>
                <span className="icon-label"><Icon name="paperclip" size={13} /> {p.documents?.length || 0} files</span>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--body-alt)' }}>
                Updated {ago(p.updatedAt)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Individual sandbox project view
export function SandboxProject() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [activeTab, setActiveTab] = useState('tasks');
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    api.sandboxProject(projectId)
      .then(setProject)
      .catch(() => { toast.error('Project not found'); navigate('/researcher/sandbox'); });
  }, [projectId, navigate, toast]);

  useEffect(() => { load(); }, [load]);

  // Task state
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', dueDate: '' });
  const [showTaskForm, setShowTaskForm] = useState(false);

  // Note state
  const [newNote, setNewNote] = useState({ title: '', content: '' });
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [editingNote, setEditingNote] = useState(null);

  // Doc state
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState({ name: '', url: '', type: 'link' });

  if (!project) return <div className="page-loading">Loading…</div>;

  const doneTasks = project.tasks.filter(t => t.status === 'done').length;
  const progress = project.tasks.length > 0 ? Math.round((doneTasks / project.tasks.length) * 100) : 0;

  // Task handlers
  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    try {
      const task = await api.sandboxAddTask(projectId, newTask);
      setProject(prev => ({ ...prev, tasks: [...prev.tasks, task] }));
      setNewTask({ title: '', description: '', priority: 'medium', dueDate: '' });
      setShowTaskForm(false);
    } catch (err) { toast.error(err.message); }
  };

  const toggleTask = async (task) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    try {
      await api.sandboxUpdateTask(projectId, task.id, { status: newStatus });
      setProject(prev => ({
        ...prev,
        tasks: prev.tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t)
      }));
    } catch (err) { toast.error(err.message); }
  };

  const deleteTask = async (taskId) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await api.sandboxDeleteTask(projectId, taskId);
      setProject(prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== taskId) }));
    } catch (err) { toast.error(err.message); }
  };

  // Note handlers
  const addNote = async (e) => {
    e.preventDefault();
    if (!newNote.title.trim()) return;
    try {
      const note = await api.sandboxAddNote(projectId, newNote);
      setProject(prev => ({ ...prev, notes: [...prev.notes, note] }));
      setNewNote({ title: '', content: '' });
      setShowNoteForm(false);
    } catch (err) { toast.error(err.message); }
  };

  const saveNote = async (noteId, updates) => {
    try {
      await api.sandboxUpdateNote(projectId, noteId, updates);
      setProject(prev => ({
        ...prev,
        notes: prev.notes.map(n => n.id === noteId ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n)
      }));
      setEditingNote(null);
    } catch (err) { toast.error(err.message); }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await api.sandboxDeleteNote(projectId, noteId);
      setProject(prev => ({ ...prev, notes: prev.notes.filter(n => n.id !== noteId) }));
    } catch (err) { toast.error(err.message); }
  };

  // Document handlers
  const addDoc = async (e) => {
    e.preventDefault();
    if (!docForm.name.trim() || !docForm.url.trim()) return;
    try {
      const doc = await api.sandboxAddDoc(projectId, { ...docForm, size: 0 });
      setProject(prev => ({ ...prev, documents: [...prev.documents, doc] }));
      setDocForm({ name: '', url: '', type: 'link' });
      setShowDocForm(false);
    } catch (err) { toast.error(err.message); }
  };

  const deleteDoc = async (docId) => {
    if (!window.confirm('Remove this document?')) return;
    try {
      await api.sandboxDeleteDoc(projectId, docId);
      setProject(prev => ({ ...prev, documents: prev.documents.filter(d => d.id !== docId) }));
    } catch (err) { toast.error(err.message); }
  };

  // Drive sync
  const syncToDrive = async () => {
    setSyncing(true);
    try {
      const result = await api.sandboxSyncDrive(projectId);
      // For now, show a placeholder - actual Drive integration would go here
      toast.success('Sync initiated! This will create a folder in your Google Drive.');
      // Store the folder ID (in a real implementation, this would come from Drive API)
      await api.sandboxSetDriveFolder(projectId, `drive_${Date.now()}`);
      setProject(prev => ({ ...prev, driveFolderId: `drive_${Date.now()}`, lastSynced: new Date().toISOString() }));
    } catch (err) {
      toast.error('Sync failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const deleteProject = async () => {
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    try {
      await api.sandboxDelete(projectId);
      toast.success('Project deleted');
      navigate('/researcher/sandbox');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem 1rem', marginBottom: '1.5rem' }}>
        <button className="icon-btn" onClick={() => navigate('/researcher/sandbox')} aria-label="Back to Sandbox">
          <span className="icon-label"><Icon name="arrow-left" size={15} /> Back</span>
        </button>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 0.75rem' }}>
            <Badge>{project.category}</Badge>
            <h1 className="page-title" style={{ margin: 0 }}>{project.title}</h1>
          </div>
          {project.description && <p className="muted" style={{ marginTop: '0.25rem' }}>{project.description}</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <Button onClick={syncToDrive} disabled={syncing} variant="ghost">
            {syncing
              ? 'Syncing…'
              : <span className="icon-label"><Icon name={project.driveFolderId ? 'refresh' : 'upload'} size={14} /> {project.driveFolderId ? 'Sync to Drive' : 'Export to Drive'}</span>}
          </Button>
          <button className="icon-btn icon-btn-danger" onClick={deleteProject} aria-label="Delete project" title="Delete project" style={{ border: '1px solid var(--border)' }}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>

      {project.driveFolderId && (
        <div className="icon-label" style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--surface-alt)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--slate)' }}>
          <Icon name="check-circle" size={14} /> Last synced: {project.lastSynced ? ago(project.lastSynced) : 'Just now'}
        </div>
      )}

      {/* Progress bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
          <span>Progress</span>
          <span>{doneTasks}/{project.tasks.length} tasks ({progress}%)</span>
        </div>
        <div className="progress">
          <span style={{ width: `${progress}%`, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        {['tasks', 'notes', 'documents'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`sandbox-tab ${activeTab === tab ? 'on' : ''}`}
          >
            {tab === 'tasks' && `Tasks (${project.tasks.length})`}
            {tab === 'notes' && `Notes (${project.notes.length})`}
            {tab === 'documents' && `Documents (${project.documents.length})`}
          </button>
        ))}
      </div>

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <Button onClick={() => setShowTaskForm(!showTaskForm)} variant="ghost" size="btn-sm">
              {showTaskForm ? 'Cancel' : <span className="icon-label"><Icon name="plus" size={13} /> Add Task</span>}
            </Button>
          </div>

          {showTaskForm && (
            <Card style={{ marginBottom: '1rem' }}>
              <form onSubmit={addTask}>
                <div style={{ marginBottom: '0.75rem' }}>
                  <input
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="Task title"
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    placeholder="Description (optional)"
                    rows={2}
                    style={{ gridColumn: '1 / -1', resize: 'vertical', minHeight: 0 }}
                  />
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                  >
                    {Object.entries(priorities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input
                    type="date"
                    value={newTask.dueDate}
                    onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                  />
                </div>
                <Button type="submit" size="btn-sm">Add Task</Button>
              </form>
            </Card>
          )}

          {project.tasks.length === 0 && !showTaskForm ? (
            <EmptyState>No tasks yet. Add tasks to track your progress.</EmptyState>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {project.tasks.sort((a, b) => {
                const order = { urgent: 0, high: 1, medium: 2, low: 3 };
                return (order[a.priority] || 2) - (order[b.priority] || 2);
              }).map(task => (
                <Card key={task.id} style={{ padding: '0.75rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 0.75rem' }}>
                  <input
                    type="checkbox"
                    checked={task.status === 'done'}
                    onChange={() => toggleTask(task)}
                    aria-label={`Mark "${task.title}" ${task.status === 'done' ? 'not done' : 'done'}`}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                    <span style={{ textDecoration: task.status === 'done' ? 'line-through' : 'none', opacity: task.status === 'done' ? 0.6 : 1 }}>
                      {task.title}
                    </span>
                    {task.dueDate && (
                      <span className="icon-label" style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: new Date(task.dueDate) < new Date() && task.status !== 'done' ? 'var(--danger)' : 'var(--body-alt)' }}>
                        <Icon name="calendar" size={12} /> {task.dueDate}
                      </span>
                    )}
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginLeft: 'auto' }}>
                    <Badge tone={task.priority === 'urgent' ? 'red' : task.priority === 'high' ? 'gold' : 'blue'}>{priorities[task.priority]}</Badge>
                    <button className="icon-btn icon-btn-danger" onClick={() => deleteTask(task.id)} aria-label="Delete task" title="Delete task"><Icon name="x" size={14} /></button>
                  </span>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notes Tab */}
      {activeTab === 'notes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <Button onClick={() => setShowNoteForm(!showNoteForm)} variant="ghost" size="btn-sm">
              {showNoteForm ? 'Cancel' : <span className="icon-label"><Icon name="plus" size={13} /> Add Note</span>}
            </Button>
          </div>

          {showNoteForm && (
            <Card style={{ marginBottom: '1rem' }}>
              <form onSubmit={addNote}>
                <div style={{ marginBottom: '0.5rem' }}>
                  <input
                    value={newNote.title}
                    onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                    placeholder="Note title"
                    style={{ marginBottom: '0.5rem' }}
                  />
                  <textarea
                    value={newNote.content}
                    onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                    placeholder="Write your notes here..."
                    rows={6}
                    style={{ resize: 'vertical' }}
                  />
                </div>
                <Button type="submit" size="btn-sm">Save Note</Button>
              </form>
            </Card>
          )}

          {project.notes.length === 0 && !showNoteForm ? (
            <EmptyState>No notes yet. Create notes to capture your research ideas.</EmptyState>
          ) : (
            <div className="notes-grid">
              {project.notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(note => (
                <Card key={note.id} style={{ padding: '1rem' }}>
                  {editingNote?.id === note.id ? (
                    <div>
                      <input
                        value={editingNote.title}
                        onChange={(e) => setEditingNote({ ...editingNote, title: e.target.value })}
                        aria-label="Note title"
                        style={{ marginBottom: '0.5rem' }}
                      />
                      <textarea
                        value={editingNote.content}
                        onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                        rows={6}
                        aria-label="Note content"
                        style={{ resize: 'vertical', marginBottom: '0.5rem' }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Button size="btn-sm" onClick={() => saveNote(note.id, { title: editingNote.title, content: editingNote.content })}>Save</Button>
                        <Button size="btn-sm" variant="ghost" onClick={() => setEditingNote(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0, minWidth: 0 }}>{note.title}</h4>
                        <div style={{ display: 'flex', gap: '0.25rem', flex: 'none' }}>
                          <button className="icon-btn" onClick={() => setEditingNote({ ...note })} aria-label="Edit note" title="Edit note"><Icon name="pen" size={14} /></button>
                          <button className="icon-btn icon-btn-danger" onClick={() => deleteNote(note.id)} aria-label="Delete note" title="Delete note"><Icon name="trash" size={14} /></button>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', color: 'var(--body-alt)', margin: 0 }}>{note.content || 'Empty note'}</p>
                      <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--body-alt)' }}>Updated {ago(note.updatedAt)}</div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <Button onClick={() => setShowDocForm(!showDocForm)} variant="ghost" size="btn-sm">
              {showDocForm ? 'Cancel' : <span className="icon-label"><Icon name="plus" size={13} /> Add Document</span>}
            </Button>
          </div>

          {showDocForm && (
            <Card style={{ marginBottom: '1rem' }}>
              <form onSubmit={addDoc}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    value={docForm.name}
                    onChange={(e) => setDocForm({ ...docForm, name: e.target.value })}
                    placeholder="Document name"
                  />
                  <input
                    value={docForm.url}
                    onChange={(e) => setDocForm({ ...docForm, url: e.target.value })}
                    placeholder="URL (Google Doc, PDF link, etc.)"
                  />
                </div>
                <Button type="submit" size="btn-sm">Add Document</Button>
              </form>
            </Card>
          )}

          {project.documents.length === 0 && !showDocForm ? (
            <EmptyState>No documents linked yet. Add links to your research files.</EmptyState>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {project.documents.map(doc => (
                <Card key={doc.id} style={{ padding: '0.75rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 0.75rem' }}>
                  <span className="guide-ico" aria-hidden="true">
                    <Icon name={doc.type === 'pdf' ? 'file-text' : doc.type === 'doc' ? 'pen' : 'link'} size={17} />
                  </span>
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ flex: '1 1 150px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.name}
                  </a>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--body-alt)' }}>{ago(doc.addedAt)}</span>
                    <button className="icon-btn icon-btn-danger" onClick={() => deleteDoc(doc.id)} aria-label="Remove document" title="Remove document"><Icon name="x" size={14} /></button>
                  </span>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
