"use client";

import { FormEvent, useState } from "react";
import { ShieldCheck, Building2, CheckCircle2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type PendingOperator = {
  id: string;
  companyName: string;
  createdAt: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingOperator[] | null>(null);
  const [loadingPending, setLoadingPending] = useState(false);

  async function json(response: Response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        Array.isArray(data.message) ? data.message.join(", ") : data.message || "Request failed",
      );
    }
    return data;
  }

  async function loadPending(accessToken: string) {
    setLoadingPending(true);
    setMessage("");
    try {
      setPending(
        await json(
          await fetch(`${API_URL}/admin/operators/pending`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load pending operators.",
      );
    } finally {
      setLoadingPending(false);
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthLoading(true);
    setMessage("");
    try {
      const data = await json(
        await fetch(`${API_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: String(form.get("email")),
            password: String(form.get("password")),
          }),
        }),
      );
      setToken(data.accessToken);
      await loadPending(data.accessToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function verify(operatorId: string) {
    if (!token) return;
    setMessage("");
    try {
      await json(
        await fetch(`${API_URL}/admin/operators/${operatorId}/verify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      setMessage("Operator verified.");
      await loadPending(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify this operator.");
    }
  }

  if (!token) {
    return (
      <main className="dashPage">
        <ThemeToggle />
        <div className="dashAuthCard">
          <p className="eyebrow">Admin</p>
          <h1>Sign in to review operators</h1>
          <form onSubmit={submitAuth}>
            <input name="email" type="email" required placeholder="Admin email" />
            <input name="password" type="password" required placeholder="Password" />
            <button className="searchButton" disabled={authLoading}>
              {authLoading ? "Please wait…" : "Sign in"}
            </button>
          </form>
          {message && <p className="notice error">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="dashPage">
      <ThemeToggle />
      <div className="dashHeader">
        <p className="eyebrow">Admin</p>
        <h1>Pending operators</h1>
      </div>

      {message && <p className="notice">{message}</p>}

      {loadingPending && <p className="hint">Loading…</p>}

      {pending && pending.length === 0 && (
        <p className="hint">
          <CheckCircle2 size={16} /> No operators awaiting verification right now.
        </p>
      )}

      <div className="fleetList">
        {pending?.map((op) => (
          <div key={op.id} className="dashCard">
            <div className="dashCardTop">
              <div className="cardIcon">
                <Building2 size={20} />
              </div>
              <div>
                <h2>{op.companyName}</h2>
                <p className="cardCity">
                  Registered {new Date(op.createdAt).toLocaleDateString([], { dateStyle: "medium" })}
                </p>
              </div>
            </div>
            <button className="searchButton fullWidth" onClick={() => verify(op.id)}>
              <ShieldCheck size={16} /> Verify operator
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}