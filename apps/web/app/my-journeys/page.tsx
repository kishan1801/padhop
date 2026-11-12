"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Plane,
  RotateCw,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError, authenticate } from "@/lib/api-client";
import {
  fetchMyBookings,
  partitionBookings,
  type PassengerBooking,
  type PassengerBookingStatus,
} from "@/lib/bookings";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const priceFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
const statusDetails: Record<
  PassengerBookingStatus,
  { label: string; icon: typeof Clock3 }
> = {
  held: { label: "On hold", icon: Clock3 },
  confirmed: { label: "Confirmed", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", icon: XCircle },
  completed: { label: "Completed", icon: CheckCircle2 },
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : dateTimeFormatter.format(date);
}

function BookingStatus({ status }: { status: PassengerBookingStatus }) {
  const { label, icon: Icon } = statusDetails[status];
  return (
    <span className={`journeyStatus journeyStatus-${status}`} aria-label={`Booking status: ${label}`}>
      <Icon size={15} aria-hidden="true" />
      {label}
    </span>
  );
}

function JourneyCard({ booking }: { booking: PassengerBooking }) {
  return (
    <article className="journeyCard">
      <header className="journeyCardHeader">
        <div className="journeyReference">
          <span>Booking reference</span>
          <code>{booking.bookingId}</code>
        </div>
        <BookingStatus status={booking.status} />
      </header>

      <h3 className="journeyAircraft">
        <Plane size={18} aria-hidden="true" />
        {booking.slot.aircraft.model}
        <span>{booking.slot.aircraft.capacity} seats</span>
      </h3>

      <div className="journeyRoute" aria-label="Journey route">
        <div className="journeyLocation">
          <span>From</span>
          <strong>{booking.slot.helipad.name}</strong>
          <small>{booking.slot.helipad.city}</small>
        </div>
        <ArrowRight className="journeyRouteArrow" size={20} aria-hidden="true" />
        <div className="journeyLocation journeyDestination">
          <span>To</span>
          <strong>{booking.destinationHelipad.name}</strong>
          <small>{booking.destinationHelipad.city}</small>
        </div>
      </div>

      <div className="journeyDetails">
        <div className="journeyDetail">
          <CalendarDays size={16} aria-hidden="true" />
          <div>
            <span>Flight time</span>
            <strong>{formatDateTime(booking.slot.startTime)}</strong>
            <small>Until {formatDateTime(booking.slot.endTime)}</small>
          </div>
        </div>
        <div className="journeyDetail">
          <div className="journeyPriceMark" aria-hidden="true">₹</div>
          <div>
            <span>Charter price</span>
            <strong>{priceFormatter.format(booking.price)}</strong>
          </div>
        </div>
      </div>

      <p className="journeyCreated">
        Booked {formatDateTime(booking.createdAt)}
      </p>
    </article>
  );
}

function JourneySkeleton() {
  return (
    <div className="journeySkeleton" role="status" aria-label="Loading journeys">
      <span className="journeySkeletonLine journeySkeletonShort" />
      <span className="journeySkeletonLine journeySkeletonTitle" />
      <span className="journeySkeletonLine journeySkeletonRoute" />
      <span className="journeySkeletonLine journeySkeletonFooter" />
    </div>
  );
}

export default function MyJourneysPage() {
  const { token, setToken } = useAuth();
  const [loadState, setLoadState] = useState<
    | {
        reloadKey: number;
        status: "success";
        bookings: PassengerBooking[];
      }
    | {
        reloadKey: number;
        status: "error";
        message: string;
      }
    | null
  >(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();
    void fetchMyBookings(token, controller.signal)
      .then((nextBookings) => {
        if (controller.signal.aborted) return;
        setLoadState({
          reloadKey,
          status: "success",
          bookings: nextBookings,
        });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (
          requestError instanceof ApiRequestError &&
          requestError.status === 401
        ) {
          setLoadState(null);
          setToken(null);
          setAuthMessage("Your session has expired. Sign in again to view your journeys.");
          return;
        }
        setLoadState({
          reloadKey,
          status: "error",
          message:
            requestError instanceof Error
              ? requestError.message
              : "Could not load your journeys.",
        });
      });

    return () => controller.abort();
  }, [token, reloadKey, setToken]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthLoading(true);
    setAuthError(null);
    try {
      const accessToken = await authenticate({
        mode: "login",
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      setToken(accessToken);
      setAuthMessage(null);
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error
          ? requestError.message
          : "Could not sign in.",
      );
    } finally {
      setAuthLoading(false);
    }
  }

  const needsAuthentication = !token;
  const currentLoad =
    token && loadState?.reloadKey === reloadKey
      ? loadState
      : null;
  const showLoading = Boolean(token) && currentLoad === null;
  const error =
    currentLoad?.status === "error" ? currentLoad.message : null;
  const bookings =
    currentLoad?.status === "success" ? currentLoad.bookings : null;
  const journeys = bookings ? partitionBookings(bookings) : null;

  return (
    <AppShell>
      <main className="journeysPage" aria-busy={showLoading}>
        <header className="journeysHeader">
          <p className="eyebrow">Your travel record</p>
          <h1>My Journeys</h1>
          <p>Review your charter details and booking status in one place.</p>
        </header>

        {needsAuthentication ? (
          <section className="journeysAuthCard" aria-labelledby="journeys-signin-title">
            <div className="journeysEmptyIcon"><Plane size={22} aria-hidden="true" /></div>
            <h2 id="journeys-signin-title">Sign in to view your journeys</h2>
            <p>Your bookings are private to your passenger account.</p>
            {authMessage && <p className="journeysNotice" role="status">{authMessage}</p>}
            <form onSubmit={signIn} className="journeysAuthForm">
              <label htmlFor="journeys-email">Email address</label>
              <input
                id="journeys-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
              <label htmlFor="journeys-password">Password</label>
              <input
                id="journeys-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
              {authError && <p className="journeysError" role="alert">{authError}</p>}
              <button className="searchButton" type="submit" disabled={authLoading}>
                {authLoading ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <p className="journeysAuthHint">
              New to PadHop? <Link href="/">Explore available charters</Link> to get started.
            </p>
          </section>
        ) : showLoading ? (
          <section className="journeyGrid" aria-label="Loading bookings">
            <JourneySkeleton />
            <JourneySkeleton />
            <JourneySkeleton />
          </section>
        ) : error ? (
          <section className="journeysMessage journeysErrorPanel" role="alert">
            <h2>We couldn’t load your journeys</h2>
            <p>{error}</p>
            <button
              className="searchButtonSecondary"
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RotateCw size={16} aria-hidden="true" />
              Retry
            </button>
          </section>
        ) : bookings?.length === 0 ? (
          <section className="journeysMessage journeysEmpty" aria-labelledby="journeys-empty-title">
            <div className="journeysEmptyIcon"><Plane size={22} aria-hidden="true" /></div>
            <h2 id="journeys-empty-title">No journeys yet</h2>
            <p>Your bookings will appear here after you place a charter hold.</p>
            <Link href="/#search" className="searchButton">Explore charters</Link>
          </section>
        ) : journeys ? (
          <div className="journeysSections">
            <section className="journeySection" aria-labelledby="upcoming-title">
              <div className="journeySectionHeader">
                <div>
                  <p className="eyebrow">Next departures</p>
                  <h2 id="upcoming-title">Upcoming journeys</h2>
                </div>
                <span className="journeyCount">{journeys.upcoming.length}</span>
              </div>
              {journeys.upcoming.length > 0 ? (
                <div className="journeyGrid">
                  {journeys.upcoming.map((booking) => (
                    <JourneyCard key={booking.bookingId} booking={booking} />
                  ))}
                </div>
              ) : (
                <p className="journeySectionEmpty">No upcoming journeys.</p>
              )}
            </section>

            <section className="journeySection" aria-labelledby="past-title">
              <div className="journeySectionHeader">
                <div>
                  <p className="eyebrow">Your record</p>
                  <h2 id="past-title">Past journeys</h2>
                </div>
                <span className="journeyCount">{journeys.past.length}</span>
              </div>
              {journeys.past.length > 0 ? (
                <div className="journeyGrid">
                  {journeys.past.map((booking) => (
                    <JourneyCard key={booking.bookingId} booking={booking} />
                  ))}
                </div>
              ) : (
                <p className="journeySectionEmpty">Past and cancelled journeys will appear here.</p>
              )}
            </section>
            <p className="journeysDisclaimer">
              Booking status does not indicate payment or operator acceptance.
            </p>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
