import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HoldRequestGate, runGuardedHold } from "./hold-request";

describe("guarded booking holds", () => {
  it("ignores rapid duplicate requests while the first request is pending", async () => {
    const gate = new HoldRequestGate();
    let resolveRequest!: (value: string) => void;
    let requestCount = 0;
    let finishCount = 0;
    const options = {
      gate,
      slotId: "slot-1",
      request: () => {
        requestCount += 1;
        return new Promise<string>((resolve) => {
          resolveRequest = resolve;
        });
      },
      onStart: () => {},
      onSuccess: () => {},
      onUnavailable: () => {},
      onError: () => {},
      onFinally: () => {
        finishCount += 1;
      },
    };

    const firstRequest = runGuardedHold(options);
    const duplicateRequest = await runGuardedHold(options);

    assert.equal(duplicateRequest, false);
    assert.equal(requestCount, 1);
    assert.equal(finishCount, 0);

    resolveRequest("held");
    assert.equal(await firstRequest, true);
    assert.equal(finishCount, 1);
    assert.notEqual(gate.acquire("slot-1"), null);
  });

  it("routes HTTP 409 to unavailable handling, refreshes, and never reports success", async () => {
    const gate = new HoldRequestGate();
    let unavailableCount = 0;
    let refreshCount = 0;
    let successCount = 0;
    let finishCount = 0;
    const error = Object.assign(new Error("Slot is no longer available"), {
      status: 409,
    });

    const result = await runGuardedHold({
      gate,
      slotId: "slot-1",
      request: async () => {
        throw error;
      },
      onStart: () => {},
      onSuccess: () => {
        successCount += 1;
      },
      onUnavailable: () => {
        unavailableCount += 1;
        refreshCount += 1;
      },
      onError: () => assert.fail("409 should use unavailable handling"),
      onFinally: () => {
        finishCount += 1;
      },
    });

    assert.equal(result, false);
    assert.equal(unavailableCount, 1);
    assert.equal(refreshCount, 1);
    assert.equal(successCount, 0);
    assert.equal(finishCount, 1);
  });

  it("resets loading and releases the gate after an ordinary failure", async () => {
    const gate = new HoldRequestGate();
    let loading = false;
    let errorCount = 0;

    await runGuardedHold({
      gate,
      slotId: "slot-1",
      request: async () => {
        throw new Error("Network failed");
      },
      onStart: () => {
        loading = true;
      },
      onSuccess: () => assert.fail("failed request should not succeed"),
      onUnavailable: () => assert.fail("ordinary error is not a conflict"),
      onError: () => {
        errorCount += 1;
      },
      onFinally: () => {
        loading = false;
      },
    });

    assert.equal(loading, false);
    assert.equal(errorCount, 1);
    assert.notEqual(gate.acquire("slot-1"), null);
  });

  it("runs success handling and releases the gate", async () => {
    const gate = new HoldRequestGate();
    let heldBookingId: string | null = null;
    let finishCount = 0;

    const result = await runGuardedHold({
      gate,
      slotId: "slot-1",
      request: async () => ({ bookingId: "booking-1" }),
      onStart: () => {},
      onSuccess: (hold) => {
        heldBookingId = hold.bookingId;
      },
      onUnavailable: () => assert.fail("successful request is not unavailable"),
      onError: () => assert.fail("successful request should not fail"),
      onFinally: () => {
        finishCount += 1;
      },
    });

    assert.equal(result, true);
    assert.equal(heldBookingId, "booking-1");
    assert.equal(finishCount, 1);
    assert.notEqual(gate.acquire("slot-1"), null);
  });

  it("does not let stale cleanup release a newer request", () => {
    const gate = new HoldRequestGate();
    const earlierRequest = gate.acquire("slot-1");

    assert.notEqual(earlierRequest, null);
    assert.equal(gate.release("slot-1", earlierRequest!), true);

    const newerRequest = gate.acquire("slot-1");
    assert.notEqual(newerRequest, null);
    assert.equal(gate.release("slot-1", earlierRequest!), false);
    assert.equal(gate.acquire("slot-1"), null);
    assert.equal(gate.release("slot-1", newerRequest!), true);
  });
});
