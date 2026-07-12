import { useState } from 'react';
import ResearchHub from './ResearchHub.jsx';
import ApplicationHub from './ApplicationHub.jsx';
import Competitions from './Competitions.jsx';
import Programs from './Programs.jsx';

// One place to find your next thing: open projects, role applications,
// competitions, and programs — previously four separate tabs.
const TABS = [
  ['projects', 'Open projects', () => <ResearchHub />],
  ['apply', 'Apply for a role', () => <ApplicationHub />],
  ['competitions', 'Competitions', () => <Competitions embedded />],
  ['programs', 'Programs', () => <Programs embedded />],
];

export default function Explore() {
  const [tab, setTab] = useState('projects');
  const Active = (TABS.find((t) => t[0] === tab) || TABS[0])[2];
  return (
    <div>
      <h1 className="page-title">Explore</h1>
      <p className="page-sub">Find your next project, role, competition, or program.</p>
      <div className="seg" style={{ marginBottom: '1.25rem' }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={`seg-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <Active />
    </div>
  );
}
