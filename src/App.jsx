import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { CompanionProvider } from './contexts/CompanionContext';
import { ChallengeInviteModal } from './components/ChallengeInviteModal';
import { AuthPage } from './pages/AuthPage';
import { KidLinkPage } from './pages/KidLinkPage';
import { CreateHandlePage } from './pages/CreateHandlePage';
import { ParentAuthPage } from './pages/ParentAuthPage';
import { ParentDashboardPage } from './pages/ParentDashboardPage';
import { ParentChildStatsPage } from './pages/ParentChildStatsPage';
import { TeacherDashboardPage } from './pages/TeacherDashboardPage';
import { TeacherClassroomPage } from './pages/TeacherClassroomPage';
import { ClassroomStatsPage } from './pages/ClassroomStatsPage';
import { ClassroomPage } from './pages/ClassroomPage';
import { ClassmateProfilePage } from './pages/ClassmateProfilePage';
import { TribesPage } from './pages/TribesPage';
import { TribemateProfilePage } from './pages/TribemateProfilePage';
import { HomePage } from './pages/HomePage';
import { MapPagePaper } from './pages/MapPagePaper';
import { BattlePage } from './pages/BattlePage';
import { PvpBattlePage } from './pages/PvpBattlePage';
import { DragonTrialPage } from './pages/DragonTrialPage';
import { LearningLairPage } from './pages/LearningLairPage';
import { LearningLairOperationPage } from './pages/LearningLairOperationPage';
import { DragonSpellingPage } from './pages/DragonSpellingPage';
import { ProvingGroundsPage } from './pages/ProvingGroundsPage';
import { DragonCollectionPage } from './pages/DragonCollectionPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { ResetPage } from './pages/ResetPage';
import { AboutPage } from './pages/AboutPage';
import { FatDragonPreviewPage } from './pages/FatDragonPreviewPage';
import { UpdateBanner } from './components/UpdateBanner';
import { VersionBadge } from './components/VersionBadge';
import { InstallHint } from './components/InstallHint';
import { GuestBanner } from './components/GuestBanner';
import { homePathFor } from './utils/homePath';

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
  if (user?.account_type !== 'parent') return <Navigate to="/map" replace />;
  // Teachers have their own dashboard.
  if (user?.adult_role === 'teacher') return <Navigate to="/teacher" replace />;
  return children;
}

function RequireTeacher({ children }) {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/parent/auth" replace />;
  if (user?.account_type !== 'parent') return <Navigate to="/map" replace />;
  if (user?.adult_role !== 'teacher') return <Navigate to="/parent" replace />;
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

      {/* Passwordless kid login by URL (QR target) + first-time handle setup. */}
      <Route path="/k/:token" element={<KidLinkPage />} />
      <Route path="/welcome" element={<RequireChildSession><CreateHandlePage /></RequireChildSession>} />

      <Route path="/home" element={<RequireKid><HomePage /></RequireKid>} />
      <Route path="/map" element={<RequireKid><MapPagePaper /></RequireKid>} />
      <Route path="/battle/:nodeId" element={<RequireKid><BattlePage /></RequireKid>} />
      <Route path="/battle/pvp/:matchId" element={<RequireKid><PvpBattlePage /></RequireKid>} />
      <Route path="/trial" element={<RequireKid><DragonTrialPage /></RequireKid>} />
      <Route path="/learning-lair" element={<RequireKid><LearningLairPage /></RequireKid>} />
      <Route path="/learning-lair/:operation" element={<RequireKid><LearningLairOperationPage /></RequireKid>} />
      <Route path="/dragon-spelling" element={<RequireKid><DragonSpellingPage /></RequireKid>} />
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
        <RealtimeProvider>
          <CompanionProvider>
            <AppRoutes />
            <ChallengeInviteModal />
            <GuestBanner />
            <UpdateBanner />
            <VersionBadge />
            <InstallHint />
          </CompanionProvider>
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
