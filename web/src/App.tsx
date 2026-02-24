import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AppHeader } from "./ui";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { FeedPage } from "./pages/FeedPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";

function ProtectedRoute({ authenticated, children }: { authenticated: boolean; children: JSX.Element }) {
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AdminRoute({ isAdmin, children }: { isAdmin: boolean; children: JSX.Element }) {
  if (!isAdmin) {
    return <Navigate to="/feed" replace />;
  }
  return children;
}

export default function App() {
  const { user, token, loading, logout } = useAuth();

  if (loading) {
    return <p className="page-state">Loading session...</p>;
  }

  return (
    <div className="app-shell">
      <AppHeader user={user} onLogout={logout} />

      <main className="main-wrap">
        <Routes>
          <Route path="/" element={<Navigate to="/feed" replace />} />
          <Route path="/feed" element={<FeedPage mode="all" token={token} />} />
          <Route path="/events/:eventId" element={<EventDetailPage token={token} />} />

          <Route path="/login" element={user ? <Navigate to="/my-feed" replace /> : <LoginPage />} />
          <Route path="/signup" element={user ? <Navigate to="/my-feed" replace /> : <SignupPage />} />

          <Route
            path="/my-feed"
            element={
              <ProtectedRoute authenticated={Boolean(user)}>
                <FeedPage mode="my" token={token} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute authenticated={Boolean(user)}>
                <SettingsPage token={token} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute authenticated={Boolean(user)}>
                <AdminRoute isAdmin={user?.role === "ADMIN"}>
                  <AdminPage token={token} />
                </AdminRoute>
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/feed" replace />} />
        </Routes>
      </main>
    </div>
  );
}
