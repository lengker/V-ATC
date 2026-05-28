"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authAPI, clearAuthTokens, getAccessToken } from "@/lib/api";

export type AuthUser = {
  id: string;
  email: string;
  displayName?: string;
  role: "admin" | "annotator" | "viewer";
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (params: { email: string; password: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const LS_KEY = "alpha.auth.user";
const FORCE_LOGIN_EVERY_TIME = true;

function readUserFromStorage(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function writeUserToStorage(user: AuthUser | null) {
  try {
    if (!user) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, JSON.stringify(user));
  } catch {
    // ignore storage failures
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (FORCE_LOGIN_EVERY_TIME) {
      clearAuthTokens();
      writeUserToStorage(null);
      setUser(null);
      setLoading(false);
      return;
    }
    const storedUser = readUserFromStorage();
    const token = getAccessToken();
    if (storedUser && token) {
      setUser(storedUser);
    } else {
      clearAuthTokens();
      writeUserToStorage(null);
      setUser(null);
    }
    setLoading(false);
  }, []);

  const login: AuthContextValue["login"] = async ({ email, password }) => {
    const username = email.trim();
    const response = await authAPI.login(username, password);
    if (!response.success || !response.data) {
      return { ok: false, error: response.error || "登录失败" };
    }

    const backendUser = response.data.user;
    const role: AuthUser["role"] =
      backendUser.role === "admin" || backendUser.role === "annotator" ? backendUser.role : "viewer";

    const nextUser: AuthUser = {
      id: backendUser.user_id,
      email: backendUser.username,
      displayName: backendUser.display_name,
      role,
    };

    setUser(nextUser);
    writeUserToStorage(nextUser);
    return { ok: true };
  };

  const logout = () => {
    void authAPI.logout();
    clearAuthTokens();
    setUser(null);
    writeUserToStorage(null);
  };

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
