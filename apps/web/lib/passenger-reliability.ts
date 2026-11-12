export class RequestSequence {
  private latestRequest = 0;

  next() {
    this.latestRequest += 1;
    return this.latestRequest;
  }

  isCurrent(requestId: number) {
    return requestId === this.latestRequest;
  }
}

export function getHoldSecondsRemaining(
  expiresAt: number,
  now = Date.now(),
) {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function formatHoldCountdown(seconds: number) {
  const remaining = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(remaining / 60);
  const secondsInMinute = remaining % 60;

  return `${String(minutes).padStart(2, '0')}:${String(secondsInMinute).padStart(2, '0')}`;
}
