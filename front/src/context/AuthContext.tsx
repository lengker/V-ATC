"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

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
    // ignore
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // client init
    setUser(readUserFromStorage());
    setLoading(false);
  }, []);

  const login: AuthContextValue["login"] = async ({ email, password }) => {
    // TODO: 接入后端 A-5 的 /api/auth/login（或 SSO）后替换这里
    // 目前用本地 mock：demo 用户
    const normalized = email.trim().toLowerCase();
    const ok =
      (normalized === "admin@alpha.local" && password === "admin123") ||
      (normalized === "annotator@alpha.local" && password === "annotator123") ||
      (normalized === "viewer@alpha.local" && password === "viewer123");

    if (!ok) {
      return { ok: false, error: "邮箱或密码错误（可用 demo 账号：admin@alpha.local / admin123）" };
    }

    const role: AuthUser["role"] =
      normalized.startsWith("admin") ? "admin" : normalized.startsWith("viewer") ? "viewer" : "annotator";

    const u: AuthUser = {
      id: normalized,
      email: normalized,
      displayName: role === "admin" ? "Admin" : role === "viewer" ? "Viewer" : "Annotator",
      role,
    };
    setUser(u);
    writeUserToStorage(u);
    return { ok: true };
  };

  const logout = () => {
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

