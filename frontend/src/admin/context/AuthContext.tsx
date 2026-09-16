// @ts-nocheck
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { adminAPI } from '../services/api';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve essere usato dentro AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  const checkAuth = useCallback(async () => {
    const token = adminAPI.getToken();
    if (token) {
      try {
        const profile = await adminAPI.getProfile();
        setEmail(profile.email);
        setUser(profile);
        setIsAuthenticated(true);
      } catch {
        adminAPI.logout();
        setIsAuthenticated(false);
        setEmail(null);
        setUser(null);
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string): Promise<void> => {
    const data = await adminAPI.login(email, password);
    setEmail(data.email);
    setIsAuthenticated(true);
    // Admin token also works as user token (same users collection, role-based)
    localStorage.setItem('user_token', data.token);
    try { setUser(await adminAPI.getProfile()); } catch { setUser({ email: data.email, role: data.role }); }
  };

  const logout = (): void => {
    adminAPI.logout();
    setEmail(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, email, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
