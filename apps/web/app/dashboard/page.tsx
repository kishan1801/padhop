"use client";

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plane, Clock, Users, Plus, CalendarClock, CircleCheckBig, LayoutDashboard, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import {
  acceptOperatorBooking,
  declineOperatorBooking,
  type OperatorBookingListItem as OperatorBooking,
  type OperatorBookingListResponse as OperatorBookingPage,
} from "@/lib/operator-bookings";

type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  helipadId: string;
  destinationHelipadId: string | null;
};
type Aircraft = {
  id: string;
  model: string;
  capacity: number;
  registration: string;
  slots: Slot[];
};
type Helipad = { id: string; name: string; city: string };

const BOOKING_FILTERS = [
  { value: "requested", label: "Requested" },
  { value: "accepted", label: "Accepted" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
  { value: "cancelled_by_passenger", label: "Cancelled by passenger" },
  { value: "cancelled_by_operator", label: "Cancelled by operator" },
  { value: "terminated_by_operator", label: "Terminated" },
] as const;

function bookingStatusLabel(status: string) {
  if (status === "confirmed") return "Confirmed (legacy)";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function DashboardPage() {
  const { user, loading: authLoading, login, signup, logout } = useAuth();
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [fleet, setFleet] = useState<Aircraft[] | null>(null);
  const [helipads, setHelipads] = useState<Helipad[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [showAddAircraft, setShowAddAircraft] = useState(false);
  const [addingSlotFor, setAddingSlotFor] = useState<string | null>(null);
  const [slotOriginId, setSlotOriginId] = useState("");
  const [slotDestinationId, setSlotDestinationId] = useState("");
  const [bookingFilter, setBookingFilter] = useState<string>("requested");
  const [bookings, setBookings] = useState<OperatorBooking[]>([]);
  const [bookingStatus, setBookingStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [bookingError, setBookingError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bookingRefreshKey, setBookingRefreshKey] = useState(0);
  const [bookingsAccountKey, setBookingsAccountKey] = useState<string | null>(
    null,
  );
  const bookingRequestSeq = useRef(0);
  const decisionInFlight = useRef(false);
  const decisionRequestSeq = useRef(0);
  const [decisionTarget, setDecisionTarget] = useState<{
    bookingId: string;
    type: "accept" | "decline";
  } | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState<{
    bookingId: string;
    reference: string;
    message: string;
  } | null>(null);
  const [decisionNotice, setDecisionNotice] = useState("");
  const bookingAccountKey = user ? `${user.id}:${user.role}` : "anonymous";
  const bookingAccountKeyRef = useRef(bookingAccountKey);
  useLayoutEffect(() => {
    bookingAccountKeyRef.current = bookingAccountKey;
  }, [bookingAccountKey]);
  const visibleBookings =
    bookingsAccountKey === bookingAccountKey ? bookings : [];
  const aircraftCount = fleet?.length ?? 0;
  const slotCount = fleet?.reduce((total, aircraft) => total + aircraft.slots.length, 0) ?? 0;
  const availableCount = fleet?.reduce(
    (total, aircraft) => total + aircraft.slots.filter((slot) => slot.status === "available").length,
    0,
  ) ?? 0;

  async function loadFleet() {
    setLoadingFleet(true);
    setMessage("");
    try {
      const response = await apiFetch<Aircraft[]>("/api/aircraft/mine");
      setFleet(response);
    } catch (error) {
      const err = error as Error & { status: number };
      if (err.status === 403) {
        setFleet([]);
        return;
      }
      setMessage(error instanceof Error ? error.message : "Could not load your fleet.");
    } finally {
      setLoadingFleet(false);
    }
  }

  useEffect(() => {
    apiFetch<Helipad[]>("/api/helipads")
      .then(setHelipads)
      .catch(() => {});
  }, []);

  // Load fleet data when the authenticated operator identity is ready.
  useEffect(() => {
    if (user && !authLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFleet();
    }
  }, [user, authLoading]);

  function resetBookingState() {
    bookingRequestSeq.current += 1;
    setBookings([]);
    setBookingsAccountKey(null);
    setNextCursor(null);
    setBookingStatus("idle");
    setBookingError("");
    setLoadingMore(false);
  }

  async function loadBookings(status = bookingFilter, append = false) {
    const requestId = ++bookingRequestSeq.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setBookingStatus("loading");
      setBookingError("");
    }
    try {
      const params = new URLSearchParams({ status, limit: "20" });
      if (append && nextCursor) params.set("cursor", nextCursor);
      const page = await apiFetch<OperatorBookingPage>(
        `/api/operator/bookings?${params.toString()}`,
        { cache: "no-store" },
      );
      if (requestId !== bookingRequestSeq.current) return;
      setBookingsAccountKey(bookingAccountKey);
      setBookings((current) =>
        append ? [...current, ...page.items] : page.items,
      );
      setNextCursor(page.nextCursor);
      setBookingStatus("ready");
    } catch (error) {
      if (requestId !== bookingRequestSeq.current) return;
      const err = error as Error & { status?: number };
      if (err.status === 403) {
        setBookings([]);
        setNextCursor(null);
        setBookingStatus("ready");
        return;
      }
      setBookingStatus("error");
      setBookingError(
        error instanceof Error
          ? error.message
          : "Could not load booking requests.",
      );
    } finally {
      if (requestId === bookingRequestSeq.current) {
        setLoadingMore(false);
      }
    }
  }

  function resetDecisionState() {
    decisionRequestSeq.current += 1;
    decisionInFlight.current = false;
    setDecisionTarget(null);
    setDeclineReason("");
    setDecisionPending(false);
    setDecisionError(null);
    setDecisionNotice("");
  }

  function openDecision(
    booking: OperatorBooking,
    type: "accept" | "decline",
  ) {
    if (decisionPending || decisionInFlight.current) return;
    setDecisionTarget({ bookingId: booking.bookingId, type });
    setDeclineReason("");
    setDecisionError(null);
    setDecisionNotice("");
  }

  function closeDecision() {
    if (decisionPending) return;
    setDecisionTarget(null);
    setDecisionError(null);
    setDeclineReason("");
  }

  function describeDecisionError(error: unknown, fallback: string) {
    if (error instanceof ApiRequestError) {
      if (error.status === 400) {
        return error.message || "Enter a valid reason before declining.";
      }
      if (error.status === 401) {
        return "Your session expired. Sign in again to continue.";
      }
      if (error.status === 403) {
        return "You do not have permission to decide this request. Operator verification may still be pending.";
      }
      if (error.status === 404) {
        return "This booking is no longer available.";
      }
      if (error.status === 409) {
        return /deadline|expired/i.test(error.message)
          ? "The 24-hour response deadline has passed."
          : "This request is no longer awaiting a decision.";
      }
      if (error.status >= 500) {
        return "PadHop could not complete this decision. Please try again.";
      }
    }
    return fallback;
  }

  async function submitDecision(
    booking: OperatorBooking,
    type: "accept" | "decline",
  ) {
    if (decisionInFlight.current || decisionPending) return;

    if (type === "decline") {
      const normalized = declineReason
        .replace(/\r\n?|\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!normalized) {
        setDecisionError({
          bookingId: booking.bookingId,
          reference: booking.reference,
          message: "Enter a reason for declining this request.",
        });
        return;
      }
      if (normalized.length > 500) {
        setDecisionError({
          bookingId: booking.bookingId,
          reference: booking.reference,
          message: "Decline reason must be 500 characters or fewer.",
        });
        return;
      }
    }

    const startedAccountKey = bookingAccountKeyRef.current;
    const requestId = ++decisionRequestSeq.current;
    const ownsCurrentRequest = () =>
      requestId === decisionRequestSeq.current &&
      bookingAccountKeyRef.current === startedAccountKey;
    decisionInFlight.current = true;
    setDecisionPending(true);
    setDecisionError(null);

    try {
      const result =
        type === "accept"
          ? await acceptOperatorBooking(booking.bookingId)
          : await declineOperatorBooking(booking.bookingId, declineReason);

      if (!ownsCurrentRequest()) return;

      setDecisionTarget(null);
      setDeclineReason("");
      setDecisionError(null);
      setDecisionNotice(
        result.idempotent
          ? type === "accept"
            ? "This request was already accepted."
            : "This request was already declined."
          : type === "accept"
            ? "Request accepted. This records operator acceptance in PadHop — it is not flight approval, dispatch authorization, or a guarantee the flight will operate."
            : "Request declined. The passenger will see the reason you provided.",
      );
      setBookingRefreshKey((key) => key + 1);
    } catch (error) {
      if (!ownsCurrentRequest()) return;
      setDecisionError({
        bookingId: booking.bookingId,
        reference: booking.reference,
        message: describeDecisionError(
          error,
          "Could not complete this decision. Please try again.",
        ),
      });
      if (
        error instanceof ApiRequestError &&
        (error.status === 404 || error.status === 409)
      ) {
        setDecisionTarget(null);
        setBookingRefreshKey((key) => key + 1);
      }
    } finally {
      if (requestId === decisionRequestSeq.current) {
        decisionInFlight.current = false;
        if (bookingAccountKeyRef.current === startedAccountKey) {
          setDecisionPending(false);
        }
      }
    }
  }

  // Account-switch and filter-change invalidation: these resets must run
  // synchronously after the account or filter changes so stale decisions and
  // bookings from the previous account never update the UI.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetDecisionState();
  }, [bookingAccountKey, bookingFilter]);

  // Reset the booking filter when the account changes so a different operator
  // never inherits another operator's selected status view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookingFilter("requested");
  }, [bookingAccountKey]);

  useEffect(() => {
    if (authLoading) return;
    // Clear any previous account's bookings before new data can render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetBookingState();
    if (user && user.role === "operator") {
      void loadBookings(bookingFilter, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingAccountKey, authLoading, bookingFilter, bookingRefreshKey]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    try {
      if (authMode === "signup") {
        await signup(
          String(form.get("name")),
          String(form.get("email")),
          String(form.get("password")),
        );
      } else {
        await login(String(form.get("email")), String(form.get("password")));
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  async function submitOnboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/api/operators/onboard", {
        method: "POST",
        body: JSON.stringify({ companyName: String(form.get("companyName")) }),
      });
      setMessage("Operator account created. Awaiting PadHop platform review before you can add aircraft.");
      await loadFleet();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not register as an operator.");
    }
  }

  async function submitAircraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/api/aircraft", {
        method: "POST",
        body: JSON.stringify({
          model: String(form.get("model")),
          capacity: Number(form.get("capacity")),
          registration: String(form.get("registration")),
        }),
      });
      setShowAddAircraft(false);
      await loadFleet();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add aircraft.");
    }
  }

  async function submitSlot(event: FormEvent<HTMLFormElement>, aircraftId: string) {
    event.preventDefault();
    if (!user) return;
    if (!slotOriginId || !slotDestinationId) {
      setMessage("Select both an origin and a destination helipad.");
      return;
    }
    if (slotOriginId === slotDestinationId) {
      setMessage("Origin and destination must be different helipads.");
      return;
    }
    const form = new FormData(event.currentTarget);
    try {
      const startDate = new Date(String(form.get("startTime")));
      if (Number.isNaN(startDate.getTime())) {
        setMessage("Select a valid departure time.");
        return;
      }
      const endDate = new Date(startDate.getTime() + Number(form.get("durationHours")) * 60 * 60 * 1000);
      await apiFetch(`/api/aircraft/${aircraftId}/slots`, {
        method: "POST",
        body: JSON.stringify({
          helipadId: slotOriginId,
          destinationHelipadId: slotDestinationId,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
        }),
      });
      setMessage("");
      setAddingSlotFor(null);
      setSlotOriginId("");
      setSlotDestinationId("");
      await loadFleet();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add slot.");
    }
  }

  async function handleLogout() {
    await logout();
    resetBookingState();
    setBookingFilter("requested");
    setFleet(null);
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

  if (!user) {
    return (
      <AppShell>
        <main className="dashPage">
          <div className="dashAuthCard">
            <p className="eyebrow">Operator dashboard</p>
            <h1>{authMode === "login" ? "Sign in to manage your fleet" : "Create an operator account"}</h1>
            <form onSubmit={submitAuth}>
              {authMode === "signup" && <input name="name" required placeholder="Your name" />}
              <input name="email" type="email" required placeholder="Email address" />
              <input name="password" type="password" minLength={8} required placeholder="Password" />
              <button className="searchButton" type="submit">
                {authMode === "login" ? "Sign in" : "Create account"}
              </button>
              <button type="button" className="textButton" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
                {authMode === "login" ? "New operator? Create an account" : "Already have an account? Sign in"}
              </button>
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
          <p className="eyebrow">Operator control center</p>
          <h1>Your fleet, at a glance</h1>
          <p>Manage aircraft availability and keep your schedule ready for booking.</p>
          <p className="dashTrustNote">
            Aircraft registration is an identifier only. It is not proof of
            airworthiness, insurance or operational approval.
          </p>
        </div>
        <section className="statGrid" aria-label="Fleet summary">
          <div className="statCard"><Plane size={18} /><span>{aircraftCount}</span><small>Aircraft</small></div>
          <div className="statCard"><CalendarClock size={18} /><span>{slotCount}</span><small>Total slots</small></div>
          <div className="statCard"><CircleCheckBig size={18} /><span>{availableCount}</span><small>Available now</small></div>
          <div className="statCard"><LayoutDashboard size={18} /><span>{helipads.length}</span><small>Helipads</small></div>
        </section>
        {user?.role === "operator" && (
        <section className="bookingSection" aria-labelledby="booking-requests-title">
          <div className="bookingSectionHeader">
            <div>
              <p className="sectionLabel">Coordination</p>
              <h2 id="booking-requests-title">Booking Requests</h2>
              <p className="bookingNotice">
                Booking requests are awaiting operator review. Viewing a request
                does not constitute acceptance or flight approval.
              </p>
            </div>
            <div className="bookingControls">
              <label className="srOnly" htmlFor="booking-filter">Booking status filter</label>
              <select
                id="booking-filter"
                value={bookingFilter}
                onChange={(event) => setBookingFilter(event.target.value)}
              >
                {BOOKING_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
              <button
                className="searchButtonSecondary"
                type="button"
                onClick={() => setBookingRefreshKey((key) => key + 1)}
                disabled={bookingStatus === "loading"}
              >
                Refresh
              </button>
            </div>
          </div>

          {decisionNotice && (
            <p className="decisionNotice" role="status">
              {decisionNotice}
            </p>
          )}

          {decisionError && (
            <p className="hint error" role="alert">
              Booking {decisionError.reference}: {decisionError.message}
            </p>
          )}

          {bookingStatus === "loading" && (
            <p className="hint" role="status">Loading booking requests…</p>
          )}
          {bookingStatus === "error" && (
            <p className="notice error" role="alert">{bookingError}</p>
          )}
          {bookingStatus === "ready" &&
            bookingsAccountKey === bookingAccountKey &&
            visibleBookings.length === 0 && (
            <p className="hint">
              No booking requests match this filter right now.
            </p>
          )}
          <div className="bookingList">
            {visibleBookings.map((booking) => (
              <article key={booking.bookingId} className="dashCard bookingCard">
                <div className="bookingCardHeader">
                  <div>
                    <p className="bookingReference">{booking.reference}</p>
                    <p className="bookingPassenger">{booking.passengerName}</p>
                  </div>
                  <Badge variant={booking.status === "requested" ? "default" : "secondary"}>
                    {bookingStatusLabel(booking.status)}
                  </Badge>
                </div>
                <p className="bookingRoute">
                  {booking.origin.name}
                  <ArrowRight size={13} aria-hidden="true" />
                  {booking.destination?.name ?? "No destination recorded"}
                </p>
                <div className="bookingMeta">
                  <span>{booking.aircraft.model} · {booking.aircraft.registration ?? "Registration not listed"}</span>
                  <span>
                    {new Date(booking.slot.startTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    {" – "}
                    {new Date(booking.slot.endTime).toLocaleString([], { timeStyle: "short" })}
                  </span>
                  {booking.status === "requested" && booking.decisionDeadline && (
                    <span className="bookingDeadline">
                      Operator response by{" "}
                      {new Date(booking.decisionDeadline).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  )}
                </div>
                {booking.status === "requested" && (
                  <>
                    <div className="bookingActions">
                      <button
                        className="searchButton"
                        type="button"
                        aria-expanded={
                          decisionTarget?.bookingId === booking.bookingId &&
                          decisionTarget.type === "accept"
                        }
                        aria-controls={`accept-panel-${booking.bookingId}`}
                        onClick={() => openDecision(booking, "accept")}
                        disabled={decisionPending}
                      >
                        Accept request
                      </button>
                      <button
                        className="searchButtonSecondary"
                        type="button"
                        aria-expanded={
                          decisionTarget?.bookingId === booking.bookingId &&
                          decisionTarget.type === "decline"
                        }
                        aria-controls={`decline-panel-${booking.bookingId}`}
                        onClick={() => openDecision(booking, "decline")}
                        disabled={decisionPending}
                      >
                        Decline request
                      </button>
                    </div>

                    {decisionTarget?.bookingId === booking.bookingId &&
                      decisionTarget.type === "accept" && (
                        <div
                          id={`accept-panel-${booking.bookingId}`}
                          className="bookingDecisionPanel"
                          role="group"
                          aria-label="Confirm booking acceptance"
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.stopPropagation();
                              closeDecision();
                            }
                          }}
                        >
                          <p className="decisionNote">
                            Accepting records operator acceptance in PadHop. It
                            is not flight approval, dispatch authorization, or a
                            guarantee that the flight will operate.
                          </p>
                          <div className="decisionButtons">
                            <button
                              className="searchButton"
                              type="button"
                              onClick={() =>
                                void submitDecision(booking, "accept")
                              }
                              disabled={decisionPending}
                              autoFocus
                            >
                              {decisionPending
                                ? "Accepting…"
                                : "Confirm acceptance"}
                            </button>
                            <button
                              className="searchButtonSecondary"
                              type="button"
                              onClick={closeDecision}
                              disabled={decisionPending}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                    {decisionTarget?.bookingId === booking.bookingId &&
                      decisionTarget.type === "decline" && (
                        <form
                          id={`decline-panel-${booking.bookingId}`}
                          className="bookingDecisionPanel"
                          aria-label="Decline booking request"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitDecision(booking, "decline");
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.stopPropagation();
                              closeDecision();
                            }
                          }}
                        >
                          <div className="decisionField">
                            <label htmlFor={`decline-reason-${booking.bookingId}`}>
                              Reason (shared with the passenger)
                            </label>
                            <textarea
                              id={`decline-reason-${booking.bookingId}`}
                              value={declineReason}
                              onChange={(event) =>
                                setDeclineReason(event.target.value)
                              }
                              maxLength={500}
                              required
                              autoFocus
                              aria-describedby={`decline-help-${booking.bookingId} decline-counter-${booking.bookingId}`}
                            />
                            <span
                              id={`decline-help-${booking.bookingId}`}
                              className="decisionNote"
                            >
                              This reason will be shown to the passenger.
                            </span>
                            <span
                              id={`decline-counter-${booking.bookingId}`}
                              className="decisionCounter"
                              aria-live="polite"
                            >
                              {declineReason.length}/500
                            </span>
                          </div>
                          <div className="decisionButtons">
                            <button
                              className="searchButton"
                              type="submit"
                              disabled={
                                decisionPending || !declineReason.trim()
                              }
                            >
                              {decisionPending
                                ? "Declining…"
                                : "Submit decline"}
                            </button>
                            <button
                              className="searchButtonSecondary"
                              type="button"
                              onClick={closeDecision}
                              disabled={decisionPending}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                  </>
                )}
              </article>
            ))}
          </div>
          {nextCursor && bookingsAccountKey === bookingAccountKey && (
            <button
              className="searchButtonSecondary fullWidth"
              type="button"
              onClick={() => void loadBookings(bookingFilter, true)}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </section>
        )}
        {message && <p className="notice">{message}</p>}
        {fleet && fleet.length === 0 && (
          <div className="dashCard emptyState">
            <span className="emptyIcon"><Plane size={22} /></span>
            <div>
              <p className="sectionLabel">Start operating</p>
              <h2>Register your operator account</h2>
              <p>Once an administrator completes PadHop&apos;s platform review of your company, you can add aircraft and publish availability. This is not regulatory certification.</p>
            </div>
            <form onSubmit={submitOnboard} className="inlineForm">
              <label className="srOnly" htmlFor="companyName">Company name</label>
              <input id="companyName" name="companyName" required placeholder="Company name" />
              <button className="searchButton">Register company</button>
            </form>
          </div>
        )}
        {loadingFleet && <p className="hint">Loading your fleet…</p>}
        <div className="fleetList">
          {fleet?.map((aircraft) => (
            <div key={aircraft.id} className="dashCard aircraftCard">
              <div className="dashCardTop">
                <div className="cardIcon"><Plane size={20} /></div>
                <div>
                  <h2>{aircraft.model}</h2>
                  <p className="cardCity">{aircraft.registration} · <Users size={13} /> {aircraft.capacity} seats</p>
                </div>
                <Badge variant="secondary">{aircraft.slots.length} slots</Badge>
              </div>
              <div className="slotList">
                {aircraft.slots.map((slot) => {
                  const originName =
                    helipads.find((helipad) => helipad.id === slot.helipadId)?.name ??
                    "Unknown origin";
                  const destinationName = slot.destinationHelipadId
                    ? helipads.find(
                        (helipad) => helipad.id === slot.destinationHelipadId,
                      )?.name ?? "Unknown destination"
                    : null;
                  return (
                    <div key={slot.id} className="slot">
                      <div className="slotInfo">
                        <span className="slotRoute">
                          {originName}
                          <ArrowRight size={12} aria-hidden="true" />
                          {destinationName ?? "No destination declared"}
                        </span>
                        <span><Clock size={13} /> {new Date(slot.startTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                      </div>
                      <Badge variant={slot.status === "available" ? "default" : "secondary"}>{slot.status}</Badge>
                    </div>
                  );
                })}
              </div>
              {addingSlotFor === aircraft.id ? (
                <form onSubmit={(event) => submitSlot(event, aircraft.id)} className="inlineForm">
                  <label className="srOnly" htmlFor={`origin-${aircraft.id}`}>Origin helipad</label>
                  <select
                    id={`origin-${aircraft.id}`}
                    name="helipadId"
                    required
                    value={slotOriginId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSlotOriginId(value);
                      if (slotDestinationId === value) {
                        setSlotDestinationId("");
                      }
                    }}
                  >
                    <option value="">Select origin</option>
                    {helipads.map((helipad) => (
                      <option key={helipad.id} value={helipad.id}>{helipad.name}</option>
                    ))}
                  </select>
                  <label className="srOnly" htmlFor={`destination-${aircraft.id}`}>Destination helipad</label>
                  <select
                    id={`destination-${aircraft.id}`}
                    name="destinationHelipadId"
                    required
                    value={slotDestinationId}
                    disabled={!slotOriginId}
                    onChange={(event) => setSlotDestinationId(event.target.value)}
                  >
                    <option value="">Select destination</option>
                    {helipads
                      .filter((helipad) => helipad.id !== slotOriginId)
                      .map((helipad) => (
                        <option key={helipad.id} value={helipad.id}>{helipad.name}</option>
                      ))}
                  </select>
                  <input name="startTime" type="datetime-local" required />
                  <input name="durationHours" type="number" min={1} max={12} defaultValue={2} required />
                  <button
                    className="searchButton"
                    disabled={!slotOriginId || !slotDestinationId || slotOriginId === slotDestinationId}
                  >
                    Add slot
                  </button>
                </form>
              ) : (
                <button
                  className="searchButtonSecondary fullWidth"
                  onClick={() => {
                    setSlotOriginId("");
                    setSlotDestinationId("");
                    setAddingSlotFor(aircraft.id);
                  }}
                >
                  <Plus size={14} /> Add availability
                </button>
              )}
            </div>
          ))}
        </div>
        {!showAddAircraft ? (
          <button className="searchButton addAircraftButton" onClick={() => setShowAddAircraft(true)}>
            <Plus size={16} /> Add aircraft
          </button>
        ) : (
          <form onSubmit={submitAircraft} className="dashCard inlineForm">
            <label className="srOnly" htmlFor="model">Aircraft model</label>
            <input id="model" name="model" required placeholder="Model (e.g. Bell 407)" />
            <label className="srOnly" htmlFor="registration">Registration</label>
            <input id="registration" name="registration" required placeholder="Registration (e.g. VT-ABC1)" />
            <label className="srOnly" htmlFor="capacity">Seat capacity</label>
            <input id="capacity" name="capacity" type="number" min={1} required placeholder="Seats" />
            <button className="searchButton">Save aircraft</button>
          </form>
        )}
        <div className="dashAuthCard" style={{ marginTop: "2rem" }}>
          <button className="textButton" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </main>
    </AppShell>
  );
}