import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import OnboardingWizard from '../../components/OnboardingWizard.jsx';
import RolePicker from '../../components/RolePicker.jsx';

// Dedicated per-role home dashboards (ROLE_WORKFLOWS §4–8).
import AssociateHome from './dashboards/AssociateHome.jsx';
import LeadHome from './dashboards/LeadHome.jsx';
import IndependentHome from './dashboards/IndependentHome.jsx';
import ChapterHome from './dashboards/ChapterHome.jsx';
import MentorHome from './dashboards/MentorHome.jsx';

import Mentors from './Mentors.jsx';
import ProjectDetail from './ProjectDetail.jsx';
import ResearchHub from './ResearchHub.jsx';
import ApplicationHub from './ApplicationHub.jsx';
import Opportunities from './Opportunities.jsx';
import Explore from './Explore.jsx';
import MyProjects from './MyProjects.jsx';
import People from './People.jsx';
import MyJournal from './MyJournal.jsx';
import Community from './Community.jsx';
import Programs from './Programs.jsx';
import Groups from './Groups.jsx';
import GroupDetail from './GroupDetail.jsx';
import Competitions from './Competitions.jsx';
import News from './News.jsx';
import Calendar from './Calendar.jsx';
import Drive from './Drive.jsx';
import Tools from '../Tools.jsx';
import Profile from '../Profile.jsx';
import Account from '../Account.jsx';
import Sandbox, { SandboxProject } from './Sandbox.jsx';

function RoleCongrats() {
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user?.newRoleCongrats) return null;
  const dismiss = async () => {
    setBusy(true);
    try { await api.updateProfile({ congratsSeen: true }); await refreshUser(); } finally { setBusy(false); }
  };
  return (
    <div className="ob-overlay">
      <div className="ob-card" style={{ textAlign: 'center' }}>
        <div className="ob-emoji"><Icon name="party" size={40} /></div>
        <h2>Congrats on your new role!</h2>
        <p>You're officially a <strong>{user.newRoleCongrats}</strong> at Synthica. Welcome aboard — your dashboard is ready.</p>
        <button className="btn btn-primary ob-next" disabled={busy} onClick={dismiss}>{busy ? '…' : "Let's go"}</button>
      </div>
    </div>
  );
}

// Researcher shell — every member gets the Member portal; the sidebar grows a
// dedicated workspace (Lead / Independent / Chapter / Mentor) per researcher
// tag, scoped via the active view so users always know which hat they're wearing.
export default function ResearcherApp() {
  const { user } = useAuth();

  const demo = user?.allViewsDemo;
  const tags = demo
    ? ['lead_researcher', 'chapter_leader', 'associate_researcher', 'independent_researcher', 'expertise_mentor']
    : (user?.tags || []);
  const isLead = demo || tags.includes('lead_researcher');
  const isIndependent = demo || tags.includes('independent_researcher');
  const isChapter = demo || tags.includes('chapter_leader');
  const isMentor = demo || tags.includes('expertise_mentor');

  const nav = [
    // ---- Member portal (every researcher) -------------------------------
    { to: '/researcher', label: 'Home', icon: 'home', end: true, views: ['researcher'] },
    { section: 'Community', views: ['researcher'] },
    { to: '/researcher/community', label: 'Feed', icon: 'megaphone', views: ['researcher'] },
    { to: '/researcher/people', label: 'People', icon: 'users', views: ['researcher'] },
    { to: '/researcher/mentors', label: 'Mentors', icon: 'graduation-cap', views: ['researcher'] },
    { section: 'Research', views: ['researcher'] },
    { to: '/researcher/hub', label: 'Research Hub', icon: 'compass', views: ['researcher'] },
    { to: '/researcher/projects', label: 'My Projects', icon: 'folder', views: ['researcher'] },
    { to: '/researcher/groups', label: 'Groups', icon: 'flask', views: ['researcher'] },
    { to: '/researcher/journal', label: 'Journal', icon: 'book-open', views: ['researcher'] },
    { to: '/researcher/calendar', label: 'Calendar', icon: 'calendar', views: ['researcher'] },
    { to: '/researcher/drive', label: 'Drive', icon: 'folder-open', views: ['researcher'] },
    { section: 'Discover', views: ['researcher'] },
    { to: '/researcher/apply', label: 'Apply for a role', icon: 'rocket', views: ['researcher'] },
    { to: '/researcher/programs', label: 'Programs', icon: 'graduation-cap', views: ['researcher'] },
    { to: '/researcher/competitions', label: 'Competitions', icon: 'party', views: ['researcher'] },

    // ---- Lead workspace -------------------------------------------------
    ...(isLead ? [
      { to: '/researcher/lead', label: 'Lead hub', icon: 'rocket', end: true, views: ['lead'] },
      { section: 'Lead workspace', views: ['lead'] },
      { to: '/researcher/hub', label: 'Listings', icon: 'compass', views: ['lead'] },
      { to: '/researcher/projects', label: 'Projects', icon: 'folder', views: ['lead'] },
      { to: '/researcher/groups', label: 'Groups', icon: 'flask', views: ['lead'] },
      { to: '/researcher/calendar', label: 'Calendar', icon: 'calendar', views: ['lead'] },
    ] : []),

    // ---- Independent workspace ------------------------------------------
    ...(isIndependent ? [
      { to: '/researcher/independent', label: 'Independent', icon: 'compass', end: true, views: ['independent'] },
      { section: 'Independent', views: ['independent'] },
      { to: '/researcher/sandbox', label: 'Sandbox', icon: 'flask', views: ['independent'] },
      { to: '/researcher/projects', label: 'My Projects', icon: 'folder', views: ['independent'] },
      { to: '/researcher/journal', label: 'Journal', icon: 'book-open', views: ['independent'] },
      { to: '/researcher/calendar', label: 'Calendar', icon: 'calendar', views: ['independent'] },
    ] : []),

    // ---- Chapter workspace ----------------------------------------------
    ...(isChapter ? [
      { to: '/researcher/chapter', label: 'Chapter', icon: 'globe', end: true, views: ['chapter'] },
      { section: 'Chapter', views: ['chapter'] },
      { to: '/researcher/community', label: 'Feed', icon: 'megaphone', views: ['chapter'] },
      { to: '/researcher/people', label: 'People', icon: 'users', views: ['chapter'] },
      { to: '/researcher/calendar', label: 'Calendar', icon: 'calendar', views: ['chapter'] },
    ] : []),

    // ---- Mentor workspace -----------------------------------------------
    ...(isMentor ? [
      { to: '/researcher/mentor', label: 'Mentor desk', icon: 'graduation-cap', end: true, views: ['mentor'] },
      { section: 'Mentor', views: ['mentor'] },
      { to: '/researcher/calendar', label: 'Calendar', icon: 'calendar', views: ['mentor'] },
    ] : []),

    { spacer: true, views: ['*'] },
    { to: '/journal', label: 'Read Journal', icon: 'books', views: ['*'] },
    { to: '/preprints', label: 'Preprints', icon: 'file-text', views: ['*'] },
    { to: '/archive', label: 'Archive', icon: 'archive', views: ['*'] },
    { to: '/researcher/account', label: 'Account', icon: 'user', views: ['*'] },
  ];

  return (
    <Layout nav={nav}>
      <RoleCongrats />
      <OnboardingWizard />
      <RolePicker />
      <Routes>
        {/* Per-role home dashboards */}
        <Route index element={<AssociateHome />} />
        <Route path="lead" element={<LeadHome />} />
        <Route path="independent" element={<IndependentHome />} />
        <Route path="chapter" element={<ChapterHome />} />
        <Route path="mentor" element={<MentorHome />} />
        <Route path="mentors" element={<Mentors />} />

        {/* Shared researcher pages */}
        <Route path="community" element={<Community />} />
        <Route path="projects" element={<MyProjects />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="drive" element={<Drive />} />
        <Route path="people" element={<People />} />
        <Route path="project/:id" element={<ProjectDetail />} />
        <Route path="journal" element={<MyJournal />} />
        <Route path="explore" element={<Explore />} />
        <Route path="opportunities" element={<Opportunities />} />
        <Route path="programs" element={<Programs />} />
        <Route path="groups" element={<Groups />} />
        <Route path="groups/:id" element={<GroupDetail />} />
        <Route path="sandbox" element={<Sandbox />} />
        <Route path="sandbox/:projectId" element={<SandboxProject />} />
        <Route path="competitions" element={<Competitions />} />
        <Route path="news" element={<News />} />
        <Route path="account" element={<Account />} />
        <Route path="hub" element={<ResearchHub />} />
        <Route path="apply" element={<ApplicationHub />} />
        <Route path="profile" element={<Profile />} />
        <Route path="tools" element={<Tools />} />
        <Route path="*" element={<Navigate to="/researcher" replace />} />
      </Routes>
    </Layout>
  );
}
