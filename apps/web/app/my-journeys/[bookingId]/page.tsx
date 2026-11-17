"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
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
import { ApiRequestError } from "@/lib/api-client";
import {
  fetchBookingById,
  hasDistinctDestination,
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
const dateOnlyFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: undefined,
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

function formatDateOnly(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : dateOnlyFormatter.format(date);
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

function DetailSkeleton() {
  return (
    <div className="detailSkeleton" role="status" aria-label="Loading booking details">
      <div className="detailSkeletonHeader">
        <span className="detailSkeletonLine detailSkeletonShort" />
        <span className="detailSkeletonLine detailSkeletonShort" />
      </div>
      <div className="detailSkeletonSection">
        <span className="detailSkeletonLine detailSkeletonTitle" />
        <span className="detailSkeletonLine detailSkeletonText" />
        <span className="detailSkeletonLine detailSkeletonText" />
      </div>
      <div className="detailSkeletonSection">
        <span className="detailSkeletonLine detailSkeletonTitle" />
        <span className="detailSkeletonLine detailSkeletonText" />
        <span className="detailSkeletonLine detailSkeletonText" />
      </div>
      <div className="detailSkeletonSection">
        <span className="detailSkeletonLine detailSkeletonTitle" />
        <span className="detailSkeletonLine detailSkeletonText" />
      </div>
    </div>
  );
}

export default function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { user, loading: authLoading } = useAuth();
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [booking, setBooking] = useState<PassengerBooking | null>(null);
  const [status, setStatus] = useState<
    "loading" | "success" | "not-found" | "unauthorized" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const loadBooking = async () => {
      const resolvedParams = await params;
      setBookingId(resolvedParams.bookingId);
    };
    loadBooking();
  }, [params]);

  useEffect(() => {
    if (!bookingId || !user || authLoading) return;

    const controller = new AbortController();
    void fetchBookingById(bookingId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          setStatus("not-found");
          return;
        }
        setBooking(result);
        setStatus("success");
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (
          requestError instanceof ApiRequestError &&
          requestError.status === 401
        ) {
          setStatus("unauthorized");
          return;
        }
        setStatus("error");
        setErrorMessage(
          requestError instanceof Error
            ? requestError.message
            : "Could not load booking details.",
        );
      });

    return () => controller.abort();
  }, [bookingId, user, authLoading, reloadKey]);

  if (status === "loading") {
    return (
      <AppShell>
        <main className="detailPage" aria-busy="true">
          <header className="detailHeader">
            <Link href="/my-journeys" className="backLink" aria-label="Back to My Journeys">
              <ArrowLeft size={20} aria-hidden="true" />
              Back to My Journeys
            </Link>
          </header>
          <DetailSkeleton />
        </main>
      </AppShell>
    );
  }

  if (status === "not-found") {
    return (
      <AppShell>
        <main className="detailPage">
          <header className="detailHeader">
            <Link href="/my-journeys" className="backLink" aria-label="Back to My Journeys">
              <ArrowLeft size={20} aria-hidden="true" />
              Back to My Journeys
            </Link>
          </header>
          <section className="detailNotFound" role="alert" aria-labelledby="not-found-title">
            <h2 id="not-found-title">Booking not found</h2>
            <p>The booking you are looking for does not exist or you do not have access to it.</p>
            <Link href="/my-journeys" className="searchButtonSecondary">
              <ArrowLeft size={16} aria-hidden="true" />
              Back to My Journeys
            </Link>
          </section>
        </main>
      </AppShell>
    );
  }

  if (status === "unauthorized") {
    return (
      <AppShell>
        <main className="detailPage">
          <header className="detailHeader">
            <Link href="/my-journeys" className="backLink" aria-label="Back to My Journeys">
              <ArrowLeft size={20} aria-hidden="true" />
              Back to My Journeys
            </Link>
          </header>
          <section className="detailError" role="alert" aria-labelledby="unauthorized-title">
            <h2 id="unauthorized-title">Session expired</h2>
            <p>Your session has expired. Please sign in again to view booking details.</p>
            <Link href="/my-journeys" className="searchButtonSecondary">
              <ArrowLeft size={16} aria-hidden="true" />
              Back to My Journeys
            </Link>
          </section>
        </main>
      </AppShell>
    );
  }

  if (status === "error") {
    return (
      <AppShell>
        <main className="detailPage">
          <header className="detailHeader">
            <Link href="/my-journeys" className="backLink" aria-label="Back to My Journeys">
              <ArrowLeft size={20} aria-hidden="true" />
              Back to My Journeys
            </Link>
          </header>
          <section className="detailError" role="alert" aria-labelledby="error-title">
            <h2 id="error-title">Could not load booking details</h2>
            <p>{errorMessage}</p>
            <button
              className="searchButtonSecondary"
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RotateCw size={16} aria-hidden="true" />
              Retry
            </button>
            <Link href="/my-journeys" className="searchButtonSecondary">
              <ArrowLeft size={16} aria-hidden="true" />
              Back to My Journeys
            </Link>
          </section>
        </main>
      </AppShell>
    );
  }

  if (!booking) {
    return null;
  }

  return (
    <AppShell>
      <main className="detailPage">
        <header className="detailHeader">
          <Link href="/my-journeys" className="backLink" aria-label="Back to My Journeys">
            <ArrowLeft size={20} aria-hidden="true" />
            Back to My Journeys
          </Link>
        </header>

        <article className="detailCard">
          <header className="detailCardHeader">
            <div className="detailReference">
              <span className="detailReferenceLabel">Booking reference</span>
              <code className="detailReferenceValue">{booking.reference}</code>
            </div>
            <BookingStatus status={booking.status} />
          </header>

          {booking.status === "requested" && (
            <p className="journeyRequestMeta">
              Requested{" "}
              {booking.requestedAt
                ? dateTimeFormatter.format(new Date(booking.requestedAt))
                : "recently"}
              {booking.decisionDeadline ? (
                <>
                  {" · "}Operator response by{" "}
                  <strong>
                    {dateTimeFormatter.format(new Date(booking.decisionDeadline))}
                  </strong>
                </>
              ) : null}
            </p>
          )}

          {booking.status === "declined" && booking.declineReason && (
            <p className="journeyDeclineReason">
              Operator reason: <strong>{booking.declineReason}</strong>
            </p>
          )}

          <section className="detailSection" aria-labelledby="aircraft-title">
            <h2 id="aircraft-title">Aircraft & Operator</h2>
            <div className="detailGrid">
              <div className="detailField">
                <Plane size={18} aria-hidden="true" />
                <div>
                  <span className="detailFieldLabel">Aircraft model</span>
                  <strong className="detailFieldValue">{booking.slot.aircraft.model}</strong>
                </div>
              </div>
              {booking.slot.aircraft.registration && (
                <div className="detailField">
                  <span className="detailFieldLabel">Registration</span>
                  <strong className="detailFieldValue">{booking.slot.aircraft.registration}</strong>
                </div>
              )}
              {booking.slot.aircraft.capacity && (
                <div className="detailField">
                  <span className="detailFieldLabel">Capacity</span>
                  <strong className="detailFieldValue">{booking.slot.aircraft.capacity} seats</strong>
                </div>
              )}
              {booking.slot.operator?.companyName && (
                <div className="detailField">
                  <span className="detailFieldLabel">Operator</span>
                  <strong className="detailFieldValue">{booking.slot.operator.companyName}</strong>
                </div>
              )}
            </div>
          </section>

          <section className="detailSection" aria-labelledby="journey-title">
            <h2 id="journey-title">Journey</h2>
            <div className="detailRoute" aria-label="Journey route">
              <div className="detailLocation">
                <span className="detailLocationLabel">From</span>
                <strong className="detailLocationValue">{booking.slot.helipad.name}</strong>
                <small className="detailLocationCity">{booking.slot.helipad.city}</small>
              </div>
              <ArrowRight className="detailRouteArrow" size={20} aria-hidden="true" />
              <div className="detailLocation detailDestination">
                <span className="detailLocationLabel">To</span>
                {hasDistinctDestination(booking) ? (
                  <>
                    <strong className="detailLocationValue">{booking.destinationHelipad?.name}</strong>
                    <small className="detailLocationCity">{booking.destinationHelipad?.city}</small>
                  </>
                ) : (
                  <>
                    <strong className="detailLocationValue">No separate destination recorded</strong>
                    <small className="detailLocationCity">
                      The hold did not specify a distinct destination helipad.
                    </small>
                  </>
                )}
              </div>
            </div>

            <div className="detailGrid">
              <div className="detailField">
                <CalendarDays size={16} aria-hidden="true" />
                <div>
                  <span className="detailFieldLabel">Departure</span>
                  <strong className="detailFieldValue">{formatDateTime(booking.slot.startTime)}</strong>
                </div>
              </div>
              <div className="detailField">
                <Clock3 size={16} aria-hidden="true" />
                <div>
                  <span className="detailFieldLabel">Arrival</span>
                  <strong className="detailFieldValue">{formatDateTime(booking.slot.endTime)}</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="detailSection" aria-labelledby="booking-info-title">
            <h2 id="booking-info-title">Booking information</h2>
            <div className="detailGrid">
              <div className="detailField">
                <CalendarDays size={16} aria-hidden="true" />
                <div>
                  <span className="detailFieldLabel">Booked on</span>
                  <strong className="detailFieldValue">{formatDateOnly(booking.createdAt)}</strong>
                </div>
              </div>
              <div className="detailField">
                <div className="detailPriceMark" aria-hidden="true">₹</div>
                <div>
                  <span className="detailFieldLabel">Charter price</span>
                  <strong className="detailFieldValue">{priceFormatter.format(booking.price)}</strong>
                </div>
              </div>
            </div>
          </section>

          <p className="detailDisclaimer">
            Booking status does not indicate payment, operator acceptance, flight approval, or actual flight completion.
          </p>
        </article>
      </main>
    </AppShell>
  );
}