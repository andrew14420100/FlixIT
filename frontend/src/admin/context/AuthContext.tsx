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

  const checkAuth = useCallback(async () => {
    const token = adminAPI.getToken();
    if (token) {
      try {
        const profile = await adminAPI.getProfile();
        setEmail(profile.email);
        setIsAuthenticated(true);
      } catch {
        adminAPI.logout();
        setIsAuthenticated(false);
        setEmail(null);
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
  };

  const logout = (): void => {
    adminAPI.logout();
    setEmail(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, email, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
