import { useState } from 'react';
import ResearchHub from './ResearchHub.jsx';
import ApplicationHub from './ApplicationHub.jsx';

// Unified "Opportunities" — find/join projects + apply for roles under one tab.
export default function Opportunities() {
  const [tab, setTab] = useState('hub');
  return (
    <div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className={`btn btn-sm ${tab === 'hub' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('hub')}>Research Hub</button>
        <button className={`btn btn-sm ${tab === 'apply' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('apply')}>Apply for a role</button>
      </div>
      {tab === 'hub' ? <ResearchHub /> : <ApplicationHub />}
    </div>
  );
}
