"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plane, Clock, Users, Plus, CalendarClock, CircleCheckBig, LayoutDashboard } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";

type Slot = { id: string; startTime: string; endTime: string; status: string };
type Aircraft = {
  id: string;
  model: string;
  capacity: number;
  registration: string;
  slots: Slot[];
};
type Helipad = { id: string; name: string; city: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [fleet, setFleet] = useState<Aircraft[] | null>(null);
  const [helipads, setHelipads] = useState<Helipad[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [showAddAircraft, setShowAddAircraft] = useState(false);
  const [addingSlotFor, setAddingSlotFor] = useState<string | null>(null);
  const aircraftCount = fleet?.length ?? 0;
  const slotCount = fleet?.reduce((total, aircraft) => total + aircraft.slots.length, 0) ?? 0;
  const availableCount = fleet?.reduce(
    (total, aircraft) => total + aircraft.slots.filter((slot) => slot.status === "available").length,
    0,
  ) ?? 0;

  async function json(response: Response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        Array.isArray(data.message) ? data.message.join(", ") : data.message || "Request failed",
      );
    }
    return data;
  }

  async function loadFleet(accessToken: string) {
    setLoadingFleet(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/aircraft/mine`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      // A newly created passenger has not registered as an operator yet.
      // Treat that expected state as an empty fleet so the onboarding form is shown.
      if (response.status === 403) {
        setFleet([]);
        return;
      }
      setFleet(await json(response));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load your fleet.");
    } finally {
      setLoadingFleet(false);
    }
  }

  useEffect(() => {
    fetch(`${API_URL}/helipads`)
      .then((res) => res.json())
      .then(setHelipads)
      .catch(() => {});
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthLoading(true);
    setMessage("");
    try {
      const body =
        authMode === "signup"
          ? {
              name: String(form.get("name")),
              email: String(form.get("email")),
              password: String(form.get("password")),
            }
          : { email: String(form.get("email")), password: String(form.get("password")) };
      const data = await json(
        await fetch(`${API_URL}/auth/${authMode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setToken(data.accessToken);
      await loadFleet(data.accessToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitOnboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    try {
      await json(
        await fetch(`${API_URL}/operators/onboard`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyName: String(form.get("companyName")) }),
        }),
      );
      setMessage("Operator account created. Awaiting admin verification before you can add aircraft.");
      await loadFleet(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not register as an operator.");
    }
  }

  async function submitAircraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    try {
      await json(
        await fetch(`${API_URL}/aircraft`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: String(form.get("model")),
            capacity: Number(form.get("capacity")),
            registration: String(form.get("registration")),
          }),
        }),
      );
      setShowAddAircraft(false);
      await loadFleet(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add aircraft.");
    }
  }

  async function submitSlot(event: FormEvent<HTMLFormElement>, aircraftId: string) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    try {
      const startDate = new Date(String(form.get("startTime")));
      const endDate = new Date(startDate.getTime() + Number(form.get("durationHours")) * 60 * 60 * 1000);
      await json(
        await fetch(`${API_URL}/aircraft/${aircraftId}/slots`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            helipadId: String(form.get("helipadId")),
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
          }),
        }),
      );
      setAddingSlotFor(null);
      await loadFleet(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add slot.");
    }
  }

  if (!token) {
    return (
      <AppShell><main className="dashPage">
        <div className="dashAuthCard">
          <p className="eyebrow">Operator dashboard</p>
          <h1>{authMode === "login" ? "Sign in to manage your fleet" : "Create an operator account"}</h1>
          <form onSubmit={submitAuth}>
            {authMode === "signup" && <input name="name" required placeholder="Your name" />}
            <input name="email" type="email" required placeholder="Email address" />
            <input name="password" type="password" minLength={8} required placeholder="Password" />
            <button className="searchButton" disabled={authLoading}>
              {authLoading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}
            </button>
            <button type="button" className="textButton" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
              {authMode === "login" ? "New operator? Create an account" : "Already have an account? Sign in"}
            </button>
          </form>
          {message && <p className="notice error">{message}</p>}
        </div>
      </main></AppShell>
    );
  }

  return (
    <AppShell><main className="dashPage">
      <div className="dashHeader"><p className="eyebrow">Operator control center</p><h1>Your fleet, at a glance</h1><p>Manage aircraft availability and keep your schedule ready for booking.</p></div>
      <section className="statGrid" aria-label="Fleet summary">
        <div className="statCard"><Plane size={18} /><span>{aircraftCount}</span><small>Aircraft</small></div>
        <div className="statCard"><CalendarClock size={18} /><span>{slotCount}</span><small>Total slots</small></div>
        <div className="statCard"><CircleCheckBig size={18} /><span>{availableCount}</span><small>Available now</small></div>
        <div className="statCard"><LayoutDashboard size={18} /><span>{helipads.length}</span><small>Helipads</small></div>
      </section>
      {message && <p className="notice">{message}</p>}
      {fleet && fleet.length === 0 && <div className="dashCard emptyState"><span className="emptyIcon"><Plane size={22} /></span><div><p className="sectionLabel">Start operating</p><h2>Register your operator account</h2><p>Once an administrator verifies your company, you can add aircraft and publish availability.</p></div><form onSubmit={submitOnboard} className="inlineForm"><label className="srOnly" htmlFor="companyName">Company name</label><input id="companyName" name="companyName" required placeholder="Company name" /><button className="searchButton">Register company</button></form></div>}
      {loadingFleet && <p className="hint">Loading your fleet…</p>}
      <div className="fleetList">
        {fleet?.map((aircraft) => (
          <div key={aircraft.id} className="dashCard aircraftCard">
            <div className="dashCardTop"><div className="cardIcon"><Plane size={20} /></div><div><h2>{aircraft.model}</h2><p className="cardCity">{aircraft.registration} · <Users size={13} /> {aircraft.capacity} seats</p></div><Badge variant="secondary">{aircraft.slots.length} slots</Badge></div>
            <div className="slotList">{aircraft.slots.map((slot) => <div key={slot.id} className="slot"><div className="slotInfo"><span><Clock size={13} /> {new Date(slot.startTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span></div><Badge variant={slot.status === "available" ? "default" : "secondary"}>{slot.status}</Badge></div>)}</div>
            {addingSlotFor === aircraft.id ? <form onSubmit={(event) => submitSlot(event, aircraft.id)} className="inlineForm"><select name="helipadId" required><option value="">Select helipad</option>{helipads.map((helipad) => <option key={helipad.id} value={helipad.id}>{helipad.name}</option>)}</select><input name="startTime" type="datetime-local" required /><input name="durationHours" type="number" min={1} max={12} defaultValue={2} required /><button className="searchButton">Add slot</button></form> : <button className="searchButtonSecondary fullWidth" onClick={() => setAddingSlotFor(aircraft.id)}><Plus size={14} /> Add availability</button>}
          </div>
        ))}
      </div>
      {!showAddAircraft ? <button className="searchButton addAircraftButton" onClick={() => setShowAddAircraft(true)}><Plus size={16} /> Add aircraft</button> : <form onSubmit={submitAircraft} className="dashCard inlineForm"><label className="srOnly" htmlFor="model">Aircraft model</label><input id="model" name="model" required placeholder="Model (e.g. Bell 407)" /><label className="srOnly" htmlFor="registration">Registration</label><input id="registration" name="registration" required placeholder="Registration (e.g. VT-ABC1)" /><label className="srOnly" htmlFor="capacity">Seat capacity</label><input id="capacity" name="capacity" type="number" min={1} required placeholder="Seats" /><button className="searchButton">Save aircraft</button></form>}
    </main></AppShell>
  );
}
