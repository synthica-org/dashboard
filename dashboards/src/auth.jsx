import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, setToken, clearToken, getToken } from './api.js';
import { canAccessPortal } from './views.js';
import PageLoader from './components/PageLoader.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from a stored token on first load.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = async (identifier, password) => {
    const res = await api.login(identifier, password);
    if (res.twoFactorRequired) return { twoFactorRequired: true, tempToken: res.tempToken };
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const verify2fa = async (tempToken, code) => {
    const { token, user } = await api.verify2fa(tempToken, code);
    setToken(token);
    setUser(user);
    return user;
  };

  const register = async (form) => {
    const { token, user } = await api.register(form);
    setToken(token);
    setUser(user);
    return user;
  };

  const loginWithGoogle = async (credential) => {
    const { token, user } = await api.googleAuth(credential);
    setToken(token);
    setUser(user);
    return user;
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  // Re-fetch the current user (e.g. to detect an auditor approving the account).
  const refreshUser = async () => {
    if (!getToken()) return null;
    try {
      const fresh = await api.me();
      setUser(fresh);
      return fresh;
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verify2fa, register, loginWithGoogle, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Greeting-safe first name: skips honorifics so "Dr. Maya Chen" greets as
// "Maya", not "Dr.". Falls back to the first word, then "there".
const HONORIFIC = /^(dr|prof|professor|mr|mrs|ms|mx|miss|sir|dame|rev|fr)\.?$/i;
export function firstNameOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.find((w) => !HONORIFIC.test(w)) || words[0] || 'there';
}

// Gate routes behind login. Editors can't reach researcher routes and vice versa.
export function RequireAuth({ children, kind }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Signing you in" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (kind && !canAccessPortal(user, kind)) return <Navigate to="/" replace />;
  return children;
}
