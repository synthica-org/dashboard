import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, RequireAuth } from './auth.jsx';
import { getDefaultHomePath } from './views.js';
import Login from './pages/Login.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import PageLoader from './components/PageLoader.jsx';

// Route-level code splitting: the two dashboards (and heavier public pages)
// load on demand, so a researcher never downloads the editor app and first
// paint ships a much smaller bundle. Login stays eager — it's the entry point.
const Register = lazy(() => import('./pages/Register.jsx'));
const Verify = lazy(() => import('./pages/Verify.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const EditorApp = lazy(() => import('./pages/editor/EditorApp.jsx'));
const ModeratorApp = lazy(() => import('./pages/moderator/ModeratorApp.jsx'));
const ResearcherApp = lazy(() => import('./pages/researcher/ResearcherApp.jsx'));
const Archive = lazy(() => import('./pages/Archive.jsx'));
const ArticleHero = lazy(() => import('./pages/ArticleHero.jsx'));
const Journal = lazy(() => import('./pages/Journal.jsx'));
const JournalVolumes = lazy(() => import('./pages/JournalVolumes.jsx'));
const JournalIssue = lazy(() => import('./pages/JournalIssue.jsx'));
const Preprints = lazy(() => import('./pages/Preprints.jsx'));
const PreprintDetail = lazy(() => import('./pages/PreprintDetail.jsx'));
const CompetitionsPublic = lazy(() => import('./pages/CompetitionsPublic.jsx'));
const PublicProfile = lazy(() => import('./pages/PublicProfile.jsx'));
const VerifyCertificate = lazy(() => import('./pages/VerifyCertificate.jsx'));

const PageFallback = () => <PageLoader label="Loading workspace" />;

// Send a logged-in user to the right dashboard based on their account kind.
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader label="Signing you in" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getDefaultHomePath(user)} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/forgot" element={<ForgotPassword />} />
        {/* Public, no login required: the archive + member profiles. */}
        <Route path="/archive" element={<Archive />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/journal/volumes" element={<JournalVolumes />} />
        <Route path="/journal/vol/:volume/issue/:issue" element={<JournalIssue />} />
        <Route path="/preprints" element={<Preprints />} />
        <Route path="/preprints/:id" element={<PreprintDetail />} />
        <Route path="/competitions" element={<CompetitionsPublic />} />
        <Route path="/article/:id" element={<ArticleHero />} />
        <Route path="/p/:key" element={<PublicProfile />} />
        <Route path="/verify-certificate" element={<VerifyCertificate />} />
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/editor/*"
          element={
            <RequireAuth kind="editor">
              <EditorApp />
            </RequireAuth>
          }
        />
        <Route
          path="/researcher/*"
          element={
            <RequireAuth kind="researcher">
              <ResearcherApp />
            </RequireAuth>
          }
        />
        <Route
          path="/moderator/*"
          element={
            <RequireAuth kind="editor">
              <ModeratorApp />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
