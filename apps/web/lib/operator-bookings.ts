import { apiFetch } from "./api-client";

export type OperatorBookingHelipad = {
  id: string;
  name: string;
  city: string;
};

export type OperatorBookingListItem = {
  bookingId: string;
  reference: string;
  status: string;
  price: number;
  createdAt: string;
  requestedAt: string | null;
  decisionDeadline: string | null;
  passengerName: string;
  origin: OperatorBookingHelipad;
  destination: OperatorBookingHelipad | null;
  slot: { startTime: string; endTime: string };
  aircraft: { model: string; registration: string | null; capacity: number };
};

export type OperatorBookingListResponse = {
  items: OperatorBookingListItem[];
  nextCursor: string | null;
};

export type OperatorBookingDetail = OperatorBookingListItem & {
  acceptedAt: string | null;
  declinedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  declineReason: string | null;
};

export type OperatorBookingDecision = OperatorBookingDetail & {
  idempotent: boolean;
};

function bookingPath(bookingId: string, action: "accept" | "decline") {
  return `/api/operator/bookings/${encodeURIComponent(bookingId)}/${action}`;
}

export function acceptOperatorBooking(bookingId: string) {
  return apiFetch<OperatorBookingDecision>(bookingPath(bookingId, "accept"), {
    method: "POST",
  });
}

export function declineOperatorBooking(bookingId: string, reason: string) {
  return apiFetch<OperatorBookingDecision>(bookingPath(bookingId, "decline"), {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
