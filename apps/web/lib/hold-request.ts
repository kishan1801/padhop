type ActiveHoldRequest = {
  slotId: string;
  requestId: number;
};

type GuardedHoldOptions<T> = {
  gate: HoldRequestGate;
  slotId: string;
  request: () => Promise<T>;
  onStart: () => void;
  onSuccess: (result: T) => void;
  onUnavailable: (error: unknown) => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
};

export class HoldRequestGate {
  private nextRequestId = 0;
  private activeRequest: ActiveHoldRequest | null = null;

  acquire(slotId: string) {
    if (this.activeRequest) return null;

    const requestId = ++this.nextRequestId;
    this.activeRequest = { slotId, requestId };
    return requestId;
  }

  release(slotId: string, requestId: number) {
    if (
      this.activeRequest?.slotId !== slotId ||
      this.activeRequest.requestId !== requestId
    ) {
      return false;
    }

    this.activeRequest = null;
    return true;
  }
}

function isConflictError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409
  );
}

export async function runGuardedHold<T>({
  gate,
  slotId,
  request,
  onStart,
  onSuccess,
  onUnavailable,
  onError,
  onFinally,
}: GuardedHoldOptions<T>) {
  const requestId = gate.acquire(slotId);
  if (requestId === null) return false;

  try {
    onStart();
    const result = await request();
    onSuccess(result);
    return true;
  } catch (error) {
    if (isConflictError(error)) {
      onUnavailable(error);
    } else {
      onError(error);
    }
    return false;
  } finally {
    if (gate.release(slotId, requestId)) onFinally();
  }
}
