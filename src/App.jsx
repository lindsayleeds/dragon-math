import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { CompanionProvider } from './contexts/CompanionContext';
import { AuthPage } from './pages/AuthPage';
import { MapPagePixel } from './pages/MapPagePixel';
import { MapPagePaper } from './pages/MapPagePaper';
import { BattlePage } from './pages/BattlePage';
import { AdminPage } from './pages/AdminPage';
import { ResetPage } from './pages/ResetPage';
import { AboutPage } from './pages/AboutPage';
import { UpdateBanner } from './components/UpdateBanner';

function ProtectedRoute({ children }) {
  const { session, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/auth" replace />;
  return children;
}

function AppRoutes() {
  const { session, loading } = useAuthContext();
  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    <Routes>
      <Route path="/auth" element={session ? <Navigate to="/map" replace /> : <AuthPage />} />
      <Route path="/map" element={<ProtectedRoute><MapPagePaper /></ProtectedRoute>} />
      <Route path="/map2" element={<ProtectedRoute><MapPagePixel /></ProtectedRoute>} />
      <Route path="/battle/:nodeId" element={<ProtectedRoute><BattlePage /></ProtectedRoute>} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/reset" element={<ProtectedRoute><ResetPage /></ProtectedRoute>} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="*" element={<Navigate to={session ? '/map' : '/auth'} replace />} />
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
