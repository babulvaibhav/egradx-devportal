import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@babulvaibhav/egradx-react';
import { LoginForm } from './LoginForm';
import { Notes } from './Notes';

export function App() {
  const navigate = useNavigate();
  return (
    <Routes>
      <Route path="/login" element={<LoginForm onSignedIn={() => navigate('/', { replace: true })} />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Notes onSignedOut={() => navigate('/login', { replace: true })} />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// docs:region web-guard
/** Pages for signed-in people only. The server checks every call anyway; this only decides what to show. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <p className="muted">Restoring your session…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}
// docs:end
