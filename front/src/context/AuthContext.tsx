"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getCurrentUser, loginWithBackend, normalizeUser, saveToken } from "@/lib/backend-api";

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
const OFFLINE_LOGIN = {
  username: "offline@alpha.local",
  password: "offline123",
} as const;

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
    const savedUser = readUserFromStorage();
    setUser(savedUser);
    if (!savedUser) {
      setLoading(false);
      return;
    }
    getCurrentUser()
      .then((res) => {
        const next = normalizeUser(res.data);
        setUser(next);
        writeUserToStorage(next);
      })
      .catch(() => {
        // token likely expired/invalid
        setUser(null);
        writeUserToStorage(null);
        saveToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login: AuthContextValue["login"] = async ({ email, password }) => {
    const normalizedInput = email.trim().toLowerCase();
    // 保底离线账号：后端不可用时也可进入系统
    if (normalizedInput === OFFLINE_LOGIN.username && password === OFFLINE_LOGIN.password) {
      saveToken(null);
      const offlineUser: AuthUser = {
        id: "offline-local-user",
        email: OFFLINE_LOGIN.username,
        displayName: "Offline Demo",
        role: "admin",
      };
      setUser(offlineUser);
      writeUserToStorage(offlineUser);
      return { ok: true };
    }

    try {
      const normalized = email.trim();
      const candidates = normalized.includes("@")
        ? [normalized, normalized.split("@")[0]]
        : [normalized];

      let lastError = "登录失败";
      for (const username of candidates) {
        try {
          const res = await loginWithBackend(username, password);
          saveToken(res.data.token);
          const u = normalizeUser(res.data.user_info);
          setUser(u);
          writeUserToStorage(u);
          return { ok: true };
        } catch (err) {
          lastError = err instanceof Error ? err.message : "登录失败";
        }
      }
      return { ok: false, error: lastError };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "网络异常，请稍后重试" };
    }
  };

  const logout = () => {
    setUser(null);
    writeUserToStorage(null);
    saveToken(null);
  };

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

