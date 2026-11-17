import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiRequestError } from "./api-client";
import {
  fetchMyBookings,
  fetchBookingById,
  hasDistinctDestination,
  partitionBookings,
  type PassengerBooking,
} from "./bookings";

const booking = (
  bookingId: string,
  status: PassengerBooking["status"],
  startTime: string,
  endTime: string,
  overrides: {
    registration?: string | null;
    operator?: { companyName: string } | null;
    reference?: string;
    originId?: string;
    destinationId?: string;
    originName?: string;
    destinationName?: string;
    destination?: PassengerBooking["destinationHelipad"];
  } = {},
): PassengerBooking => ({
  bookingId,
  reference: overrides.reference ?? `PH-20261113-${bookingId.slice(-8).toUpperCase().padStart(8, 'A')}`,
  status,
  price: 48000,
  createdAt: "2026-11-01T10:00:00.000Z",
  requestedAt: null,
  decisionDeadline: null,
  declineReason: null,
  slot: {
    startTime,
    endTime,
    aircraft: {
      model: "Bell 407",
      capacity: 6,
      registration: overrides.registration ?? "VT-TEST1",
    },
    operator: overrides.operator ?? { companyName: "Test Charter Co" },
    helipad: {
      id: overrides.originId ?? "origin-1",
      name: overrides.originName ?? "Origin",
      city: "Bengaluru",
    },
  },
  destinationHelipad:
    overrides.destination === undefined
      ? {
          id: overrides.destinationId ?? "destination-1",
          name: overrides.destinationName ?? "Destination",
          city: "Bengaluru",
        }
      : overrides.destination,
});

describe("passenger bookings API", () => {
  it("requests only the authenticated passenger's bookings without caching", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response("[]", { status: 200 });
    };

    const result = await fetchMyBookings(undefined, fetcher);

    assert.deepEqual(result, []);
    assert.equal(requestUrl.endsWith("/bookings/mine"), true);
    assert.equal(requestInit?.credentials, "include");
    assert.equal(requestInit?.cache, "no-store");
  });

  it("surfaces unauthorized responses for session expiry handling", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      });

    await assert.rejects(
      fetchMyBookings(undefined, fetcher),
      (error: unknown) =>
        error instanceof ApiRequestError &&
        error.status === 401 &&
        error.message === "Unauthorized",
    );
  });

  it("separates active upcoming bookings from in-progress and past history", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const items = [
      booking("future-confirmed", "confirmed", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z"),
      booking("future-held", "held", "2026-11-14T10:00:00Z", "2026-11-14T11:00:00Z"),
      booking(
        "in-progress",
        "confirmed",
        "2026-11-13T10:00:00Z",
        "2026-11-13T14:00:00Z",
      ),
      booking("past-confirmed", "confirmed", "2026-11-01T10:00:00Z", "2026-11-01T11:00:00Z"),
      booking("cancelled-future", "cancelled", "2026-11-25T10:00:00Z", "2026-11-25T11:00:00Z"),
      booking("completed-future", "completed", "2026-11-25T10:00:00Z", "2026-11-25T11:00:00Z"),
    ];

    const result = partitionBookings(items, now);

    assert.deepEqual(
      result.upcoming.map((item) => item.bookingId),
      ["future-held", "future-confirmed"],
    );
    assert.deepEqual(
      result.inProgress.map((item) => item.bookingId),
      ["in-progress"],
    );
    assert.deepEqual(
      result.past.map((item) => item.bookingId),
      ["cancelled-future", "completed-future", "past-confirmed"],
    );
  });

  it("treats an operator-pending request as an upcoming journey", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const items = [
      booking(
        "requested-upcoming",
        "requested",
        "2026-11-20T10:00:00Z",
        "2026-11-20T11:00:00Z",
      ),
    ];

    const result = partitionBookings(items, now);

    assert.deepEqual(
      result.upcoming.map((item) => item.bookingId),
      ["requested-upcoming"],
    );
    assert.deepEqual(result.inProgress, []);
    assert.deepEqual(result.past, []);
  });

  it("classifies a confirmed booking exactly at startTime as in progress", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const items = [
      booking(
        "at-start",
        "confirmed",
        "2026-11-13T12:00:00Z",
        "2026-11-13T14:00:00Z",
      ),
    ];

    const result = partitionBookings(items, now);

    assert.deepEqual(
      result.inProgress.map((item) => item.bookingId),
      ["at-start"],
    );
    assert.deepEqual(result.upcoming.map((item) => item.bookingId), []);
    assert.deepEqual(result.past.map((item) => item.bookingId), []);
  });

  it("classifies a confirmed booking exactly at endTime as in progress", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const items = [
      booking(
        "at-end",
        "confirmed",
        "2026-11-13T10:00:00Z",
        "2026-11-13T12:00:00Z",
      ),
    ];

    const result = partitionBookings(items, now);

    assert.deepEqual(
      result.inProgress.map((item) => item.bookingId),
      ["at-end"],
    );
    assert.deepEqual(result.upcoming.map((item) => item.bookingId), []);
    assert.deepEqual(result.past.map((item) => item.bookingId), []);
  });

  it("classifies a held booking exactly at endTime as past", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const items = [
      booking(
        "held-at-end",
        "held",
        "2026-11-13T10:00:00Z",
        "2026-11-13T12:00:00Z",
      ),
    ];

    const result = partitionBookings(items, now);

    assert.deepEqual(
      result.past.map((item) => item.bookingId),
      ["held-at-end"],
    );
    assert.deepEqual(result.upcoming.map((item) => item.bookingId), []);
    assert.deepEqual(result.inProgress.map((item) => item.bookingId), []);
  });

  it("routes bookings with invalid or missing dates to past", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const items = [
      booking("invalid-dates", "confirmed", "invalid", "invalid"),
      booking("empty-dates", "held", "", ""),
      booking("future-invalid", "confirmed", "2026-11-20T10:00:00Z", "invalid"),
    ];

    const result = partitionBookings(items, now);

    assert.deepEqual(
      result.past.map((item) => item.bookingId).sort(),
      ["empty-dates", "future-invalid", "invalid-dates"].sort(),
    );
    assert.deepEqual(result.upcoming.map((item) => item.bookingId), []);
    assert.deepEqual(result.inProgress.map((item) => item.bookingId), []);
  });

  it("does not duplicate bookings across sections", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const items = [
      booking("a", "held", "2026-11-14T10:00:00Z", "2026-11-14T11:00:00Z"),
      booking("b", "confirmed", "2026-11-13T10:00:00Z", "2026-11-13T14:00:00Z"),
      booking("c", "confirmed", "2026-11-01T10:00:00Z", "2026-11-01T11:00:00Z"),
      booking("d", "cancelled", "2026-11-25T10:00:00Z", "2026-11-25T11:00:00Z"),
      booking("e", "completed", "2026-11-25T10:00:00Z", "2026-11-25T11:00:00Z"),
    ];

    const result = partitionBookings(items, now);
    const all = [
      ...result.upcoming,
      ...result.inProgress,
      ...result.past,
    ].map((item) => item.bookingId);

    assert.deepEqual(all.sort(), ["a", "b", "c", "d", "e"].sort());
    assert.equal(all.length, new Set(all).size);
  });

  it("returns aircraft registration when present", () => {
    const item = booking("reg-present", "confirmed", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z", {
      registration: "VT-ABC1",
    });

    assert.equal(item.slot.aircraft.registration, "VT-ABC1");
  });

  it("returns null aircraft registration when absent", () => {
    const item = booking("reg-absent", "confirmed", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z", {
      registration: null,
    });

    assert.equal(item.slot.aircraft.registration, null);
  });

  it("returns operator companyName when present", () => {
    const item = booking("op-present", "confirmed", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z", {
      operator: { companyName: "SkyCharters Pvt Ltd" },
    });

    assert.equal(item.slot.operator?.companyName, "SkyCharters Pvt Ltd");
  });

  it("returns null operator when absent", () => {
    const item = booking("op-absent", "confirmed", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z", {
      operator: null,
    });

    assert.equal(item.slot.operator, null);
  });

  it("returns an empty partition for a passenger with no bookings", () => {
    assert.deepEqual(partitionBookings([]), {
      upcoming: [],
      inProgress: [],
      past: [],
    });
  });
});

describe("fetchBookingById", () => {
  const sampleBooking: PassengerBooking = {
    bookingId: "booking-1",
    reference: "PH-20261113-ABC12345",
    status: "confirmed",
    price: 48000,
    createdAt: "2026-11-12T10:00:00.000Z",
    requestedAt: null,
    decisionDeadline: null,
    declineReason: null,
    slot: {
      startTime: "2026-11-20T10:00:00Z",
      endTime: "2026-11-20T11:00:00Z",
      aircraft: {
        model: "Bell 407",
        capacity: 6,
        registration: "VT-TEST1",
      },
      operator: { companyName: "Test Charter Co" },
      helipad: { id: "origin-1", name: "Origin", city: "Bengaluru" },
    },
    destinationHelipad: {
      id: "destination-1",
      name: "Destination",
      city: "Bengaluru",
    },
  };

  it("returns the booking on successful response", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify(sampleBooking), { status: 200 });
    };

    const result = await fetchBookingById("booking-1", undefined, fetcher);

    assert.deepEqual(result, sampleBooking);
    assert.equal(requestUrl.endsWith("/bookings/booking-1"), true);
    assert.equal(requestInit?.credentials, "include");
    assert.equal(requestInit?.cache, "no-store");
  });

  it("returns null on 404 not found", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });

    const result = await fetchBookingById("missing-booking", undefined, fetcher);

    assert.equal(result, null);
  });

  it("propagates 401 unauthorized error", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });

    await assert.rejects(
      fetchBookingById("booking-1", undefined, fetcher),
      (error: unknown) =>
        error instanceof ApiRequestError &&
        error.status === 401 &&
        error.message === "Unauthorized",
    );
  });

  it("propagates server errors", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500 });

    await assert.rejects(
      fetchBookingById("booking-1", undefined, fetcher),
      (error: unknown) =>
        error instanceof ApiRequestError &&
        error.status === 500 &&
        error.message === "Internal Server Error",
    );
  });

  it("includes credentials with request", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      capturedInit = init;
      return new Response(JSON.stringify(sampleBooking), { status: 200 });
    };

    await fetchBookingById("booking-1", undefined, fetcher);

    assert.equal(capturedInit?.credentials, "include");
  });
});

describe("hasDistinctDestination", () => {
  it("returns true when origin and destination IDs differ", () => {
    const item = booking(
      "distinct",
      "confirmed",
      "2026-11-20T10:00:00Z",
      "2026-11-20T11:00:00Z",
      { originId: "origin-1", destinationId: "destination-1" },
    );

    assert.equal(hasDistinctDestination(item), true);
  });

  it("returns false when origin and destination IDs match", () => {
    const item = booking(
      "same-ids",
      "confirmed",
      "2026-11-20T10:00:00Z",
      "2026-11-20T11:00:00Z",
      { originId: "helipad-1", destinationId: "helipad-1" },
    );

    assert.equal(hasDistinctDestination(item), false);
  });

  it("returns false when the destination is missing", () => {
    const item = booking(
      "missing-destination",
      "confirmed",
      "2026-11-20T10:00:00Z",
      "2026-11-20T11:00:00Z",
      { destination: null },
    );

    assert.equal(hasDistinctDestination(item), false);
  });

  it("relies on IDs, not names, when names differ but IDs match", () => {
    const item = booking(
      "same-ids-different-names",
      "confirmed",
      "2026-11-20T10:00:00Z",
      "2026-11-20T11:00:00Z",
      {
        originId: "helipad-1",
        destinationId: "helipad-1",
        originName: "HAL Helipad",
        destinationName: "Legacy label for the same helipad",
      },
    );

    assert.equal(hasDistinctDestination(item), false);
  });

  it("treats legacy payloads without IDs as having no distinct destination", () => {
    const legacy = {
      bookingId: "legacy",
      reference: "PH-20261113-LEGACYAA",
      status: "confirmed",
      price: 48000,
      createdAt: "2026-11-01T10:00:00.000Z",
  requestedAt: null,
  decisionDeadline: null,
  declineReason: null,
      slot: {
        startTime: "2026-11-20T10:00:00Z",
        endTime: "2026-11-20T11:00:00Z",
        aircraft: { model: "Bell 407", capacity: 6, registration: null },
        operator: null,
        helipad: { name: "HAL Helipad", city: "Bengaluru" },
      },
      destinationHelipad: { name: "HAL Helipad", city: "Bengaluru" },
    } as unknown as PassengerBooking;

    assert.equal(hasDistinctDestination(legacy), false);
  });
});