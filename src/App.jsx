import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { CompanionProvider } from './contexts/CompanionContext';
import { AuthPage } from './pages/AuthPage';
import { KidLinkPage } from './pages/KidLinkPage';
import { CreateHandlePage } from './pages/CreateHandlePage';
import { ParentAuthPage } from './pages/ParentAuthPage';
import { ParentDashboardPage } from './pages/ParentDashboardPage';
import { ParentChildStatsPage } from './pages/ParentChildStatsPage';
import { MapPagePaper } from './pages/MapPagePaper';
import { BattlePage } from './pages/BattlePage';
import { DragonTrialPage } from './pages/DragonTrialPage';
import { AdminPage } from './pages/AdminPage';
import { ResetPage } from './pages/ResetPage';
import { AboutPage } from './pages/AboutPage';
import { UpdateBanner } from './components/UpdateBanner';

function homePathFor(user) {
  return user?.account_type === 'parent' ? '/parent' : '/map';
}

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
  return children;
}

function AppRoutes() {
  const { session, user, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    <Routes>
      <Route path="/auth" element={session ? <Navigate to={homePathFor(user)} replace /> : <AuthPage />} />
      <Route path="/parent/auth" element={session ? <Navigate to={homePathFor(user)} replace /> : <ParentAuthPage />} />

      {/* Passwordless kid login by URL (QR target) + first-time handle setup. */}
      <Route path="/k/:token" element={<KidLinkPage />} />
      <Route path="/welcome" element={<RequireChildSession><CreateHandlePage /></RequireChildSession>} />

      <Route path="/map" element={<RequireKid><MapPagePaper /></RequireKid>} />
      <Route path="/battle/:nodeId" element={<RequireKid><BattlePage /></RequireKid>} />
      <Route path="/trial" element={<RequireKid><DragonTrialPage /></RequireKid>} />
      <Route path="/reset" element={<RequireKid><ResetPage /></RequireKid>} />

      <Route path="/parent" element={<RequireParent><ParentDashboardPage /></RequireParent>} />
      <Route path="/parent/children/:childId" element={<RequireParent><ParentChildStatsPage /></RequireParent>} />

      <Route path="/admin" element={<AdminPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="*" element={<Navigate to={session ? homePathFor(user) : '/auth'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CompanionProvider>
          <AppRoutes />
          <UpdateBanner />
        </CompanionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
