"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  hasOperatorProfile: boolean;
  isVerified: boolean;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = "Request failed";
    if (data && typeof data === "object" && "message" in data) {
      const responseMessage = data.message;
      if (typeof responseMessage === "string" && responseMessage.trim()) {
        message = responseMessage;
      } else if (Array.isArray(responseMessage)) {
        const messages = responseMessage.filter(
          (item): item is string => typeof item === "string",
        );
        if (messages.length > 0) message = messages.join(", ");
      }
    }
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

async function getCsrfToken(): Promise<string | null> {
  try {
    const data = await fetchJson<{ ok: boolean }>("/api/auth/csrf", {
      method: "GET",
    });
    if (data.ok) {
      const cookies = document.cookie.split("; ");
      for (const cookie of cookies) {
        if (cookie.startsWith("csrf_token=")) {
          const value = cookie.substring("csrf_token=".length);
          const parts = value.split(".");
          if (parts.length === 2 && parts[0]) {
            return parts[0];
          }
        }
      }
    }
  } catch {
    // CSRF token not available, continue without it
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await fetchJson<{ user: User }>("/api/auth/me");
      setUser(data.user);
      setAuthError(null);
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 401) {
        // Signed out is an expected state, not a failure.
        setUser(null);
        setAuthError(null);
      } else {
        // Network, 403 and 5xx failures remain visible instead of being
        // swallowed or turned into a logged-out state.
        setAuthError(err.message || "Could not verify your session.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await getCsrfToken();
      if (mounted) {
        await refresh();
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const csrfToken = await getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
    await fetchJson<{ user: User }>("/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password }),
    });
    await refresh();
  };

  const signup = async (name: string, email: string, password: string) => {
    const csrfToken = await getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
    await fetchJson<{ user: User }>("/api/auth/signup", {
      method: "POST",
      headers,
      body: JSON.stringify({ name, email, password }),
    });
    await refresh();
  };

  const logout = async () => {
    const csrfToken = await getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
    await fetchJson<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
      headers,
    });
    setUser(null);
    setAuthError(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, authError, login, signup, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}