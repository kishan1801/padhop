import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatHoldCountdown,
  getHoldSecondsRemaining,
  RequestSequence,
} from './passenger-reliability';

describe('passenger reliability helpers', () => {
  it('marks an earlier request stale after a newer request begins', () => {
    const requests = new RequestSequence();
    const earlierRequest = requests.next();
    const latestRequest = requests.next();

    assert.equal(requests.isCurrent(earlierRequest), false);
    assert.equal(requests.isCurrent(latestRequest), true);
  });

  it('rounds remaining hold time up and clamps expired holds to zero', () => {
    assert.equal(getHoldSecondsRemaining(4_001, 3_000), 2);
    assert.equal(getHoldSecondsRemaining(2_999, 3_000), 0);
  });

  it('formats the countdown as minutes and seconds', () => {
    assert.equal(formatHoldCountdown(300), '05:00');
    assert.equal(formatHoldCountdown(61), '01:01');
    assert.equal(formatHoldCountdown(-1), '00:00');
  });
});
