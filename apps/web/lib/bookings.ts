import { apiFetch, ApiRequestError } from "./api-client";

export type PassengerBookingStatus =
  | "held"
  | "requested"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled_by_passenger"
  | "cancelled_by_operator"
  | "terminated_by_operator"
  | "in_progress"
  | "completed"
  | "confirmed"
  | "cancelled";

export type BookingHelipad = {
  id: string;
  name: string;
  city: string;
};

export type PassengerBooking = {
  bookingId: string;
  reference: string;
  status: PassengerBookingStatus;
  price: number;
  createdAt: string;
  requestedAt: string | null;
  decisionDeadline: string | null;
  declineReason: string | null;
  slot: {
    startTime: string;
    endTime: string;
    aircraft: {
      model: string;
      capacity: number;
      registration: string | null;
    };
    operator: {
      companyName: string;
    } | null;
    helipad: BookingHelipad;
  };
  destinationHelipad: BookingHelipad | null;
};

/**
 * A booking only has a distinct destination when its recorded destination
 * helipad ID differs from the origin helipad ID. Records created before
 * destinations were captured (or historical holds that reused the origin)
 * must never be presented as a fabricated route.
 */
export function hasDistinctDestination(booking: PassengerBooking): boolean {
  const originId = booking.slot?.helipad?.id;
  const destinationId = booking.destinationHelipad?.id;
  return Boolean(originId && destinationId && originId !== destinationId);
}

export async function fetchMyBookings(
  signal?: AbortSignal,
  fetcher?: typeof fetch,
): Promise<PassengerBooking[]> {
  return apiFetch<PassengerBooking[]>("/api/bookings/mine", {
    cache: "no-store",
    signal,
  }, fetcher);
}

export async function fetchBookingById(
  bookingId: string,
  signal?: AbortSignal,
  fetcher?: typeof fetch,
): Promise<PassengerBooking | null> {
  try {
    return await apiFetch<PassengerBooking>(`/api/bookings/${bookingId}`, {
      cache: "no-store",
      signal,
    }, fetcher);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export type PassengerJourneyGroups = {
  upcoming: PassengerBooking[];
  inProgress: PassengerBooking[];
  past: PassengerBooking[];
};

export function partitionBookings(
  bookings: PassengerBooking[],
  now = Date.now(),
): PassengerJourneyGroups {
  const isInProgress = (booking: PassengerBooking) =>
    booking.status === "in_progress" ||
    (booking.status === "confirmed" &&
      Date.parse(booking.slot.startTime) <= now &&
      Date.parse(booking.slot.endTime) >= now);

  const isUpcoming = (booking: PassengerBooking) =>
    (booking.status === "held" ||
      booking.status === "requested" ||
      booking.status === "accepted" ||
      booking.status === "confirmed") &&
    Date.parse(booking.slot.endTime) > now &&
    !isInProgress(booking);

  return {
    upcoming: bookings
      .filter(isUpcoming)
      .sort(
        (left, right) =>
          Date.parse(left.slot.startTime) - Date.parse(right.slot.startTime),
      ),
    inProgress: bookings
      .filter(isInProgress)
      .sort(
        (left, right) =>
          Date.parse(left.slot.startTime) - Date.parse(right.slot.startTime),
      ),
    past: bookings
      .filter((booking) => !isInProgress(booking) && !isUpcoming(booking))
      .sort(
        (left, right) =>
          Date.parse(right.slot.startTime) - Date.parse(left.slot.startTime),
      ),
  };
}