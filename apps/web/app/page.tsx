"use client";

import { FormEvent, useState, useRef, useEffect } from "react";
import { MapPin, Plane, Clock, Users, Loader2, MessageCircle } from "lucide-react";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

type Helipad = {
  id: string;
  name: string;
  city: string;
  distance_km: number;
  available_slots: number;
};
type Slot = {
  id: string;
  startTime: string;
  aircraft: { model: string; capacity: number };
};
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function SearchPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Helipad[]>([]);
  const [radiusKm, setRadiusKm] = useState(50);
  const [selectedHelipad, setSelectedHelipad] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);
  const [heldSlot, setHeldSlot] = useState<Slot | null>(null);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [authLoading, setAuthLoading] = useState(false);
  const authPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingSlot && !token) {
      authPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [pendingSlot, token]);

  async function json(response: Response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        Array.isArray(data.message) ? data.message.join(", ") : data.message || "Request failed",
      );
    return data;
  }

  async function runSearch(lat: number, lng: number) {
    setStatus("loading");
    setMessage("");
    setSelectedHelipad(null);
    try {
      setResults(
        await json(
          await fetch(`${API_URL}/helipads/nearest?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`),
        ),
      );
      setStatus("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Search failed");
      setStatus("error");
    }
  }

  function nearMe() {
    if (!navigator.geolocation) {
      setMessage("Location services are not supported in this browser.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => runSearch(position.coords.latitude, position.coords.longitude),
      () => {
        setMessage("We couldn't access your location. Try the Bengaluru demo instead.");
        setStatus("error");
      },
    );
  }

  async function showSlots(id: string) {
    setSelectedHelipad(id);
    setLoadingSlots(true);
    setMessage("");
    try {
      setSlots(await json(await fetch(`${API_URL}/helipads/${id}/slots`)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load aircraft.");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function hold(slot: Slot, accessToken = token) {
    if (!accessToken) {
      setPendingSlot(slot);
      return;
    }
    try {
      await json(
        await fetch(`${API_URL}/bookings/hold/${slot.id}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      setHeldSlot(slot);
      setPendingSlot(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not hold this charter.");
    }
  }

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
      if (pendingSlot) await hold(pendingSlot, data.accessToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function confirm() {
    if (!token || !heldSlot) return;
    try {
      await json(
        await fetch(`${API_URL}/bookings/confirm/${heldSlot.id}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      setHeldSlot(null);
      setMessage("Your charter is confirmed. We'll share flight details shortly.");
      if (selectedHelipad) await showSlots(selectedHelipad);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm this charter.");
    }
  }

  return (
    <main className="page">
      <ThemeToggle />
      <Link href="/assistant" className="chatFab" aria-label="Chat with PadHop Assistant">
        <MessageCircle size={22} />
      </Link>
      <section className="hero">
        <Image
          src="https://images.unsplash.com/photo-1557818673-effec50525e1?q=80&w=1600&auto=format&fit=crop"
          alt=""
          fill
          priority
          className="heroImage"
        />
        <div className="heroContent">
          <p className="eyebrow">PadHop</p>
          <h1>Find a charter, right where you are.</h1>
          <p className="subhead">
            Real helicopters, real-time availability. Search your nearest helipad and book in minutes.
          </p>
          <div className="searchPanel">
            <div className="field">
              <label htmlFor="radius">Search radius</label>
              <select id="radius" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))}>
                <option value={10}>10 km</option>
                <option value={25}>25 km</option>
                <option value={50}>50 km</option>
                <option value={100}>100 km</option>
              </select>
            </div>
            <button className="searchButton" onClick={nearMe} disabled={status === "loading"}>
              {status === "loading" ? <><Loader2 size={16} className="spin" /> Searching</> : "Search near me"}
            </button>
            <button
              className="searchButtonSecondary"
              onClick={() => runSearch(12.9716, 77.5946)}
              disabled={status === "loading"}
            >
              Try Bengaluru
            </button>
          </div>
        </div>
      </section>

      {pendingSlot && !token && (
        <section className="authPanel" ref={authPanelRef}>
          <p className="eyebrow">One last step</p>
          <h2>{authMode === "signup" ? "Create your passenger account" : "Welcome back"}</h2>
          <p>Sign in to hold this aircraft for five minutes.</p>
          <form onSubmit={submitAuth}>
            {authMode === "signup" && <input name="name" required placeholder="Your name" />}
            <input name="email" type="email" required placeholder="Email address" />
            <input name="password" type="password" minLength={8} required placeholder="Password" />
            <button className="searchButton" disabled={authLoading}>
              {authLoading ? "Please wait…" : authMode === "signup" ? "Create account & hold" : "Sign in & hold"}
            </button>
            <button
              type="button"
              className="textButton"
              onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}
            >
              {authMode === "signup" ? "Already have an account? Sign in" : "New to PadHop? Create an account"}
            </button>
          </form>
        </section>
      )}

      {heldSlot && (
        <section className="holdPanel">
          <div>
            <p className="eyebrow">Aircraft held</p>
            <h2><Plane size={18} /> {heldSlot.aircraft.model}</h2>
            <p>Your slot is reserved for five minutes. Confirm to complete this demo booking.</p>
          </div>
          <button className="searchButton" onClick={confirm}>
            Confirm charter
          </button>
        </section>
      )}

      {message && <p className={`notice ${status === "error" ? "error" : ""}`}>{message}</p>}

      <section className="results" aria-live="polite">
        {status === "idle" && (
          <p className="hint">Search near you, or try Bengaluru to see live demo availability.</p>
        )}
        {status === "done" && results.length === 0 && (
          <p className="hint">No charters are available nearby right now. Try a wider search radius.</p>
        )}
        {results.map((helipad, i) => (
          <article key={helipad.id} className="card" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="cardTop">
              <div className="cardIcon">
                <Plane size={20} />
              </div>
              <div className="cardMain">
                <h2>{helipad.name}</h2>
                <p className="cardCity">
                  <MapPin size={13} /> {helipad.city} · {helipad.distance_km.toFixed(1)} km away
                </p>
              </div>
              <Badge variant={helipad.available_slots > 0 ? "default" : "secondary"}>
                {helipad.available_slots} {helipad.available_slots === 1 ? "charter" : "charters"}
              </Badge>
            </div>
            <button className="searchButtonSecondary fullWidth" onClick={() => showSlots(helipad.id)}>
              {selectedHelipad === helipad.id ? "Refresh flights" : "View flights"}
            </button>
            {selectedHelipad === helipad.id && (
              <div className="slotList">
                {loadingSlots ? (
                  <p>Loading available aircraft…</p>
                ) : slots.length === 0 ? (
                  <p>No aircraft are available at this helipad now.</p>
                ) : (
                  slots.map((slot) => (
                    <div className="slot" key={slot.id}>
                      <div className="slotInfo">
                        <strong>{slot.aircraft.model}</strong>
                        <span>
                          <Clock size={13} />{" "}
                          {new Date(slot.startTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                          {" · "}
                          <Users size={13} /> {slot.aircraft.capacity} seats
                        </span>
                      </div>
                      <button className="searchButton" onClick={() => hold(slot)}>
                        Hold charter
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}