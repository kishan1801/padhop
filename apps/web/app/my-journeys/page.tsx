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
import {
  fetchMyBookings,
  hasDistinctDestination,
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
  { label: string; description: string; icon: typeof Clock3 }
> = {
  held: {
    label: "On hold",
    description:
      "This is a temporary booking hold. It expires automatically if not confirmed.",
    icon: Clock3,
  },
  requested: {
    label: "Requested",
    description:
      "Awaiting operator response. PadHop has not accepted this request; acceptance and flight approval rest with the licensed operator.",
    icon: Clock3,
  },
  accepted: {
    label: "Accepted by operator",
    description:
      "The operator accepted this request in PadHop. Flight approval and operational clearance remain with the operator and pilots.",
    icon: CheckCircle2,
  },
  declined: {
    label: "Declined",
    description:
      "The operator declined this request. The slot was released.",
    icon: XCircle,
  },
  expired: {
    label: "Request expired",
    description:
      "No operator response was received before the 24-hour deadline, so the request expired and the slot was released.",
    icon: XCircle,
  },
  cancelled_by_passenger: {
    label: "Cancelled by you",
    description: "You cancelled this request before commencement.",
    icon: XCircle,
  },
  cancelled_by_operator: {
    label: "Cancelled by operator",
    description: "The operator cancelled this journey before commencement.",
    icon: XCircle,
  },
  terminated_by_operator: {
    label: "Journey terminated",
    description:
      "The operator recorded a termination for this journey. Contact the operator for operational details.",
    icon: XCircle,
  },
  in_progress: {
    label: "In progress",
    description:
      "The operator recorded journey commencement. Flight status details are not shown here.",
    icon: Plane,
  },
  confirmed: {
    label: "Confirmed",
    description:
      "Your booking is confirmed in PadHop. This does not mean operator acceptance, payment, or flight approval.",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Hold expired",
    description:
      "This temporary hold expired automatically and the slot was released.",
    icon: XCircle,
  },
  completed: {
    label: "Completed",
    description: "Flight completion tracking is not currently available.",
    icon: CheckCircle2,
  },
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : dateTimeFormatter.format(date);
}

function BookingStatus({ status }: { status: PassengerBookingStatus }) {
  const { label, description, icon: Icon } = statusDetails[status];
  return (
    <div className="journeyStatusGroup" aria-label={`Booking status: ${label}`}>
      <span className={`journeyStatus journeyStatus-${status}`}>
        <Icon size={15} aria-hidden="true" />
        {label}
      </span>
      <span className="journeyStatusDescription">{description}</span>
    </div>
  );
}

function JourneyCard({ booking }: { booking: PassengerBooking }) {
  return (
    <Link href={`/my-journeys/${booking.bookingId}`} className="journeyCardLink">
      <article className="journeyCard">
      <header className="journeyCardHeader">
        <div className="journeyReference">
          <span>Booking reference</span>
          <code>{booking.reference}</code>
        </div>
        <BookingStatus status={booking.status} />
      </header>

      {booking.status === "requested" && (
        <p className="journeyRequestMeta">
          Requested{" "}
          {booking.requestedAt
            ? formatDateTime(booking.requestedAt)
            : "recently"}
          {booking.decisionDeadline ? (
            <>
              {" · "}Operator response by{" "}
              <strong>{formatDateTime(booking.decisionDeadline)}</strong>
            </>
          ) : null}
        </p>
      )}

      <h3 className="journeyAircraft">
        <Plane size={18} aria-hidden="true" />
        <span className="journeyAircraftModel">{booking.slot.aircraft.model}</span>
        <span className="journeyAircraftCapacity">{booking.slot.aircraft.capacity} seats</span>
      </h3>
      {booking.slot.aircraft.registration && (
        <p className="journeyAircraftRegistration">
          Registration: {booking.slot.aircraft.registration}
        </p>
      )}

      <div className="journeyRoute" aria-label="Journey route">
        <div className="journeyLocation">
          <span className="journeyLocationLabel">From</span>
          <strong className="journeyLocationValue">{booking.slot.helipad.name}</strong>
          <small className="journeyLocationCity">{booking.slot.helipad.city}</small>
        </div>
        <ArrowRight className="journeyRouteArrow" size={20} aria-hidden="true" />
        <div className="journeyLocation journeyDestination">
          <span className="journeyLocationLabel">To</span>
          {hasDistinctDestination(booking) ? (
            <>
              <strong className="journeyLocationValue">{booking.destinationHelipad?.name}</strong>
              <small className="journeyLocationCity">{booking.destinationHelipad?.city}</small>
            </>
          ) : (
            <>
              <strong className="journeyLocationValue">No separate destination recorded</strong>
              <small className="journeyLocationCity">The hold did not specify a distinct destination helipad.</small>
            </>
          )}
        </div>
      </div>

      {booking.slot.operator?.companyName && (
        <div className="journeyOperator">
          <span className="journeyOperatorLabel">Operator</span>
          <strong className="journeyOperatorValue">{booking.slot.operator.companyName}</strong>
        </div>
      )}

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
                  <span>Estimated price (PadHop estimate)</span>
            <strong>{priceFormatter.format(booking.price)}</strong>
          </div>
        </div>
      </div>

      <p className="journeyCreated">
        Booked {formatDateTime(booking.createdAt)}
      </p>
    </article>
  </Link>
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
  const { user, loading: authLoading, login } = useAuth();
  const [bookings, setBookings] = useState<PassengerBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user || authLoading) return;

    const controller = new AbortController();
    void fetchMyBookings(controller.signal)
      .then((nextBookings) => {
        if (controller.signal.aborted) return;
        setBookings(nextBookings);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load your journeys.",
        );
      });

    return () => controller.abort();
  }, [user, authLoading, reloadKey]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      await login(String(form.get("email")), String(form.get("password")));
      setAuthMessage(null);
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error
          ? requestError.message
          : "Could not sign in.",
      );
    } finally {
      setAuthSubmitting(false);
    }
  }

  const needsAuthentication = !user && !authLoading;
  const showLoading = Boolean(user) && !authLoading && bookings === null;
  const journeys = bookings ? partitionBookings(bookings) : null;

  return (
    <AppShell>
      <main className="journeysPage" aria-busy={showLoading}>
        <header className="journeysHeader">
          <p className="eyebrow">Your travel record</p>
          <h1>My Journeys</h1>
          <p>Review your journey details and booking status in one place.</p>
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
              <button className="searchButton" type="submit" disabled={authSubmitting}>
                {authSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <p className="journeysAuthHint">
              New to PadHop? <Link href="/">Explore available journeys</Link> to get started.
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
          <p>Your bookings will appear here after you start a journey request.</p>
          <Link href="/#search" className="searchButton">Explore journeys</Link>
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

            <section className="journeySection" aria-labelledby="in-progress-title">
              <div className="journeySectionHeader">
                <div>
                  <p className="eyebrow">In progress</p>
                  <h2 id="in-progress-title">In progress journeys</h2>
                </div>
                <span className="journeyCount">{journeys.inProgress.length}</span>
              </div>
              {journeys.inProgress.length > 0 ? (
                <div className="journeyGrid">
                  {journeys.inProgress.map((booking) => (
                    <JourneyCard key={booking.bookingId} booking={booking} />
                  ))}
                </div>
              ) : (
                <p className="journeySectionEmpty">No journeys in progress right now.</p>
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
                <p className="journeySectionEmpty">Past and expired journeys will appear here.</p>
              )}
            </section>
            <p className="journeysDisclaimer">
              Booking status does not indicate payment, operator acceptance, flight approval, or actual flight completion.
            </p>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
