import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiRequestError, authenticate } from "./api-client";
import {
  fetchMyBookings,
  partitionBookings,
  type PassengerBooking,
} from "./bookings";

const booking = (
  bookingId: string,
  status: PassengerBooking["status"],
  startTime: string,
  endTime: string,
): PassengerBooking => ({
  bookingId,
  status,
  price: 48000,
  createdAt: "2026-11-01T10:00:00.000Z",
  slot: {
    startTime,
    endTime,
    aircraft: { model: "Bell 407", capacity: 6 },
    helipad: { name: "Origin", city: "Bengaluru" },
  },
  destinationHelipad: { name: "Destination", city: "Bengaluru" },
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

    const result = await fetchMyBookings("session-token", undefined, fetcher);

    assert.deepEqual(result, []);
    assert.equal(requestUrl.endsWith("/bookings/mine"), true);
    assert.equal(
      new Headers(requestInit?.headers).get("Authorization"),
      "Bearer session-token",
    );
    assert.equal(requestInit?.cache, "no-store");
  });

  it("surfaces unauthorized responses for session expiry handling", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
      });

    await assert.rejects(
      fetchMyBookings("session-token", undefined, fetcher),
      (error: unknown) =>
        error instanceof ApiRequestError &&
        error.status === 401 &&
        error.message === "Unauthorized",
    );
  });

  it("authenticates through the existing login endpoint", async () => {
    let requestUrl = "";
    let requestBody = "";
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ accessToken: "test-access-token" }), {
        status: 200,
      });
    };

    const token = await authenticate(
      { mode: "login", email: "passenger@example.test", password: "test-password" },
      fetcher,
    );

    assert.equal(requestUrl.endsWith("/auth/login"), true);
    assert.deepEqual(JSON.parse(requestBody), {
      email: "passenger@example.test",
      password: "test-password",
    });
    assert.equal(token, "test-access-token");
  });

  it("separates active upcoming bookings from completed and cancelled history", () => {
    const now = Date.parse("2026-11-13T00:00:00.000Z");
    const items = [
      booking("later", "confirmed", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z"),
      booking("earlier", "held", "2026-11-14T10:00:00Z", "2026-11-14T11:00:00Z"),
      booking("cancelled", "cancelled", "2026-11-25T10:00:00Z", "2026-11-25T11:00:00Z"),
      booking("completed", "completed", "2026-11-01T10:00:00Z", "2026-11-01T11:00:00Z"),
    ];

    const result = partitionBookings(items, now);

    assert.deepEqual(
      result.upcoming.map((item) => item.bookingId),
      ["earlier", "later"],
    );
    assert.deepEqual(
      result.past.map((item) => item.bookingId),
      ["cancelled", "completed"],
    );
  });

  it("returns an empty partition for a passenger with no bookings", () => {
    assert.deepEqual(partitionBookings([]), { upcoming: [], past: [] });
  });
});
