import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthContext } from './contexts/AuthContext';
import { AuthProvider } from './contexts/AuthProvider';
import { CompanionProvider } from './contexts/CompanionProvider';
import { AuthPage } from './pages/AuthPage';
import { UpdateBanner } from './components/UpdateBanner';
import { VersionBadge } from './components/VersionBadge';
import { InstallHint } from './components/InstallHint';
import { GuestBanner } from './components/GuestBanner';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { homePathFor } from './utils/homePath';

// Every route below /auth is code-split so the initial download stays small.
// Pages are named exports, so map the name onto `default` for lazy().
// AuthPage stays eager: it's the landing screen every visit starts on.
const lazyPage = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));

const KidLinkPage = lazyPage(() => import('./pages/KidLinkPage'), 'KidLinkPage');
const CreateHandlePage = lazyPage(() => import('./pages/CreateHandlePage'), 'CreateHandlePage');
const ParentAuthPage = lazyPage(() => import('./pages/ParentAuthPage'), 'ParentAuthPage');
const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');
const VerifyEmailPage = lazyPage(() => import('./pages/VerifyEmailPage'), 'VerifyEmailPage');
const ParentDashboardPage = lazyPage(() => import('./pages/ParentDashboardPage'), 'ParentDashboardPage');
const ParentChildStatsPage = lazyPage(() => import('./pages/ParentChildStatsPage'), 'ParentChildStatsPage');
const TeacherDashboardPage = lazyPage(() => import('./pages/TeacherDashboardPage'), 'TeacherDashboardPage');
const TeacherClassroomPage = lazyPage(() => import('./pages/TeacherClassroomPage'), 'TeacherClassroomPage');
const ClassroomStatsPage = lazyPage(() => import('./pages/ClassroomStatsPage'), 'ClassroomStatsPage');
const SchoolDashboardPage = lazyPage(() => import('./pages/SchoolDashboardPage'), 'SchoolDashboardPage');
const ClassroomPage = lazyPage(() => import('./pages/ClassroomPage'), 'ClassroomPage');
const ClassmateProfilePage = lazyPage(() => import('./pages/ClassmateProfilePage'), 'ClassmateProfilePage');
const TribesPage = lazyPage(() => import('./pages/TribesPage'), 'TribesPage');
const TribemateProfilePage = lazyPage(() => import('./pages/TribemateProfilePage'), 'TribemateProfilePage');
const HomePage = lazyPage(() => import('./pages/HomePage'), 'HomePage');
const MapPagePaper = lazyPage(() => import('./pages/MapPagePaper'), 'MapPagePaper');
const BattlePage = lazyPage(() => import('./pages/BattlePage'), 'BattlePage');
const DragonTrialPage = lazyPage(() => import('./pages/DragonTrialPage'), 'DragonTrialPage');
const LearningLairPage = lazyPage(() => import('./pages/LearningLairPage'), 'LearningLairPage');
const LearningLairOperationPage = lazyPage(() => import('./pages/LearningLairOperationPage'), 'LearningLairOperationPage');
const DragonSpellingPage = lazyPage(() => import('./pages/DragonSpellingPage'), 'DragonSpellingPage');
const DragonPhonicsPage = lazyPage(() => import('./pages/DragonPhonicsPage'), 'DragonPhonicsPage');
const ProvingGroundsPage = lazyPage(() => import('./pages/ProvingGroundsPage'), 'ProvingGroundsPage');
const DragonCollectionPage = lazyPage(() => import('./pages/DragonCollectionPage'), 'DragonCollectionPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const AdminPage = lazyPage(() => import('./pages/AdminPage'), 'AdminPage');
const ResetPage = lazyPage(() => import('./pages/ResetPage'), 'ResetPage');
const AboutPage = lazyPage(() => import('./pages/AboutPage'), 'AboutPage');
const PrivacyPolicyPage = lazyPage(() => import('./pages/PrivacyPolicyPage'), 'PrivacyPolicyPage');
const TermsPage = lazyPage(() => import('./pages/TermsPage'), 'TermsPage');
const FatDragonPreviewPage = lazyPage(() => import('./pages/FatDragonPreviewPage'), 'FatDragonPreviewPage');

function RequireKid({ children }) {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/auth" replace />;
  if (user?.account_type === 'parent') return <Navigate to="/parent" replace />;
  // Parent-created kids must pick a handle before entering the game.
  if (user?.needs_handle) return <Navigate to="/welcome" replace />;
  return children;
}

// Like RequireKid but does NOT bounce needs_handle kids — this is where they go
// to set their handle. CreateHandlePage sends already-set-up kids on to /map.
function RequireChildSession({ children }) {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/auth" replace />;
  if (user?.account_type === 'parent') return <Navigate to="/parent" replace />;
  return children;
}

function RequireParent({ children }) {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/parent/auth" replace />;
  // A non-parent here is usually the "Test the games" sandbox: enterTestMode()
  // flips account_type to 'guest' (urgent) while the URL is still /parent, and
  // react-router defers the follow-up navigate('/home') as a transition. Bounce
  // to the user's real home hub, not a hard-coded /map, so that race lands right.
  if (user?.account_type !== 'parent') return <Navigate to={homePathFor(user)} replace />;
  // Teachers have their own dashboard.
  if (user?.adult_role === 'teacher') return <Navigate to="/teacher" replace />;
  return children;
}

function RequireTeacher({ children }) {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/parent/auth" replace />;
  // See RequireParent: bounce to the real home hub so the test-mode race lands right.
  if (user?.account_type !== 'parent') return <Navigate to={homePathFor(user)} replace />;
  if (user?.adult_role !== 'teacher') return <Navigate to="/parent" replace />;
  return children;
}

// Any signed-in adult (parent OR teacher). School-admin status isn't in the JWT,
// so the /school page itself fetches the adult's administered schools and shows
// an empty state if there are none — the per-school APIs enforce admin access.
function RequireAdult({ children }) {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/parent/auth" replace />;
  if (user?.account_type !== 'parent') return <Navigate to={homePathFor(user)} replace />;
  return children;
}

function AppRoutes() {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    <Routes>
      {/* Landing decides welcome-back vs. choices itself, so it always renders. */}
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/parent/auth" element={session ? <Navigate to={homePathFor(user)} replace /> : <ParentAuthPage />} />

      {/* Legal documents. Public and session-independent on purpose: they have to
          be readable before anyone signs up, and a school or app-store reviewer
          must be able to reach them without an account. */}
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsPage />} />

      {/* Public account-recovery pages — each carries its own token in the URL. */}
      <Route path="/parent/forgot" element={<ForgotPasswordPage />} />
      <Route path="/parent/reset" element={<ResetPasswordPage />} />
      <Route path="/parent/verify" element={<VerifyEmailPage />} />

      {/* Passwordless kid login by URL (QR target) + first-time handle setup. */}
      <Route path="/k/:token" element={<KidLinkPage />} />
      <Route path="/welcome" element={<RequireChildSession><CreateHandlePage /></RequireChildSession>} />

      <Route path="/home" element={<RequireKid><HomePage /></RequireKid>} />
      <Route path="/map" element={<RequireKid><MapPagePaper /></RequireKid>} />
      <Route path="/battle/:nodeId" element={<RequireKid><BattlePage /></RequireKid>} />
      <Route path="/trial" element={<RequireKid><DragonTrialPage /></RequireKid>} />
      <Route path="/learning-lair" element={<RequireKid><LearningLairPage /></RequireKid>} />
      <Route path="/learning-lair/:operation" element={<RequireKid><LearningLairOperationPage /></RequireKid>} />
      <Route path="/dragon-spelling" element={<RequireKid><DragonSpellingPage /></RequireKid>} />
      <Route path="/dragon-phonics" element={<RequireKid><DragonPhonicsPage /></RequireKid>} />
      <Route path="/collection" element={<RequireKid><DragonCollectionPage /></RequireKid>} />
      <Route path="/proving-grounds" element={<RequireKid><ProvingGroundsPage /></RequireKid>} />
      <Route path="/settings" element={<RequireKid><SettingsPage /></RequireKid>} />
      <Route path="/classroom" element={<RequireKid><ClassroomPage /></RequireKid>} />
      <Route path="/classroom/student/:childId" element={<RequireKid><ClassmateProfilePage /></RequireKid>} />
      <Route path="/tribes" element={<RequireKid><TribesPage /></RequireKid>} />
      <Route path="/tribes/member/:childId" element={<RequireKid><TribemateProfilePage /></RequireKid>} />
      <Route path="/reset" element={<RequireKid><ResetPage /></RequireKid>} />

      <Route path="/parent" element={<RequireParent><ParentDashboardPage /></RequireParent>} />
      <Route path="/parent/children/:childId" element={<RequireParent><ParentChildStatsPage /></RequireParent>} />

      <Route path="/teacher" element={<RequireTeacher><TeacherDashboardPage /></RequireTeacher>} />
      <Route path="/teacher/classroom/:classroomId" element={<RequireTeacher><TeacherClassroomPage /></RequireTeacher>} />
      <Route path="/teacher/classroom/:classroomId/stats" element={<RequireTeacher><ClassroomStatsPage /></RequireTeacher>} />

      <Route path="/school" element={<RequireAdult><SchoolDashboardPage /></RequireAdult>} />

      <Route path="/admin" element={<AdminPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/preview/fat-dragon" element={<FatDragonPreviewPage />} />
      {/* Root and unknown paths land on the welcome screen — returning users
          see "tap to enter" there rather than being thrown straight in. */}
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CompanionProvider>
          {/* Covers the lazy() route chunks above; matches the in-app
              loading screen the auth gates already render. The boundary
              wraps only Suspense so the banners below stay mounted while a
              route chunk is in flight. */}
          <RouteErrorBoundary>
            <Suspense fallback={<div className="loading-screen">Loading...</div>}>
              <AppRoutes />
            </Suspense>
          </RouteErrorBoundary>
          <GuestBanner />
          <UpdateBanner />
          <VersionBadge />
          <InstallHint />
        </CompanionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
