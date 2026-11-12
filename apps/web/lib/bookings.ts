import { API_URL, json } from "./api-client";

export type PassengerBookingStatus =
  | "held"
  | "confirmed"
  | "cancelled"
  | "completed";

export type PassengerBooking = {
  bookingId: string;
  status: PassengerBookingStatus;
  price: number;
  createdAt: string;
  slot: {
    startTime: string;
    endTime: string;
    aircraft: {
      model: string;
      capacity: number;
    };
    helipad: {
      name: string;
      city: string;
    };
  };
  destinationHelipad: {
    name: string;
    city: string;
  };
};

export async function fetchMyBookings(
  accessToken: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PassengerBooking[]> {
  return json<PassengerBooking[]>(
    await fetcher(`${API_URL}/bookings/mine`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal,
    }),
  );
}

export function partitionBookings(
  bookings: PassengerBooking[],
  now = Date.now(),
) {
  const isUpcoming = (booking: PassengerBooking) =>
    (booking.status === "held" || booking.status === "confirmed") &&
    Date.parse(booking.slot.endTime) >= now;

  return {
    upcoming: bookings
      .filter(isUpcoming)
      .sort(
        (left, right) =>
          Date.parse(left.slot.startTime) - Date.parse(right.slot.startTime),
      ),
    past: bookings
      .filter((booking) => !isUpcoming(booking))
      .sort(
        (left, right) =>
          Date.parse(right.slot.startTime) - Date.parse(left.slot.startTime),
      ),
  };
}
