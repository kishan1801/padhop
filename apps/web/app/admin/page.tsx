"use client";

import { FormEvent, useEffect, useState } from "react";
import { ShieldCheck, Building2, CheckCircle2, Clock3 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";

type PendingOperator = {
  id: string;
  companyName: string;
  createdAt: string;
};

export default function AdminPage() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingOperator[] | null>(null);
  const [loadingPending, setLoadingPending] = useState(false);

  async function loadPending() {
    setLoadingPending(true);
    setMessage("");
    try {
      const data = await apiFetch<PendingOperator[]>("/api/admin/operators/pending");
      setPending(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load pending operators.");
    } finally {
      setLoadingPending(false);
    }
  }

  useEffect(() => {
    if (user && !authLoading) {
      loadPending();
    }
  }, [user, authLoading]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    try {
      await login(String(form.get("email")), String(form.get("password")));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  async function verify(operatorId: string) {
    if (!user) return;
    setMessage("");
    try {
      await apiFetch(`/api/admin/operators/${operatorId}/verify`, {
        method: "POST",
      });
      setMessage("Platform review recorded.");
      await loadPending();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify this operator.");
    }
  }

  async function handleLogout() {
    await logout();
    setPending(null);
    setMessage("");
  }

  if (authLoading) {
    return (
      <AppShell>
        <main className="dashPage">
          <p className="hint">Loading…</p>
        </main>
      </AppShell>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <AppShell>
        <main className="dashPage">
          <div className="dashAuthCard">
            <p className="eyebrow">Admin</p>
            <h1>Sign in to review operators</h1>
            <form onSubmit={submitAuth}>
              <input name="email" type="email" required placeholder="Admin email" />
              <input name="password" type="password" required placeholder="Password" />
              <button className="searchButton" type="submit">Sign in</button>
            </form>
            {message && <p className="notice error">{message}</p>}
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="dashPage">
        <div className="dashHeader">
          <p className="eyebrow">Administration</p>
          <h1>Operator verification queue</h1>
          <p>
            Complete PadHop&apos;s platform review for operator companies. This is
            not regulatory certification or approval of aircraft, pilots or
            landing sites.
          </p>
        </div>

        {message && <p className="notice">{message}</p>}

        {loadingPending && <p className="hint">Loading…</p>}

        {pending && pending.length === 0 && (
          <p className="hint emptyHint">
            <CheckCircle2 size={16} /> No operators awaiting verification right now.
          </p>
        )}

        <div className="fleetList">
          {pending?.map((op) => (
            <div key={op.id} className="dashCard approvalCard">
              <div className="dashCardTop">
                <div className="cardIcon">
                  <Building2 size={20} />
                </div>
                <div>
                  <h2>{op.companyName}</h2>
                  <p className="cardCity">
                    <Clock3 size={13} /> Registered {new Date(op.createdAt).toLocaleDateString([], { dateStyle: "medium" })}
                  </p>
                </div>
              </div>
              <button className="searchButton fullWidth" onClick={() => verify(op.id)}>
                <ShieldCheck size={16} /> Record platform review
              </button>
            </div>
          ))}
        </div>
        <div className="dashAuthCard" style={{ marginTop: "2rem" }}>
          <button className="textButton" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </main>
    </AppShell>
  );
}