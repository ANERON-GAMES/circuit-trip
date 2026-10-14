import { CircuitState, DecisionReason, Outcome, TripMode } from "./constants.js";
import { openDuration } from "./duration.js";
import { createBreaker, nextState, readState } from "./state.js";
import { pushOutcome, rateTripped } from "./window.js";

export { createBreaker };

export function canPass(breaker, nowMs) {
  const current = readState(breaker);
  assertNow(nowMs);
  if (current.state === CircuitState.Closed) {
    return allow(DecisionReason.Allow, nextState(current, {}), null);
  }
  if (current.state === CircuitState.Open) {
    return passOpen(current, nowMs);
  }
  return passHalfOpen(current);
}

export function recordSuccess(breaker, nowMs, probe) {
  return record(breaker, nowMs, probe, false);
}

export function recordFailure(breaker, nowMs, probe) {
  return record(breaker, nowMs, probe, true);
}

function record(breaker, nowMs, probe, failed) {
  const current = readState(breaker);
  assertNow(nowMs);
  assertProbe(probe);
  if (current.state === CircuitState.Open) {
    throw new RangeError("cannot record an outcome while the breaker is open");
  }
  if (current.state === CircuitState.Closed) {
    if (probe !== null) {
      throw new RangeError("probe must be null while the breaker is closed");
    }
    return recordClosed(current, nowMs, failed);
  }
  return recordProbe(current, nowMs, probe, failed);
}

function passOpen(current, nowMs) {
  if (nowMs - current.openedAtMs < current.openForMs) {
    return reject(DecisionReason.RejectOpen, current);
  }
  const probe = allocateProbe(current);
  const opened = nextState(current, {
    state: CircuitState.HalfOpen,
    consecutiveProbeSuccesses: 0,
    probes: [probe],
    nextProbe: probe + 1
  });
  return allow(DecisionReason.AllowProbe, opened, probe);
}

function passHalfOpen(current) {
  if (current.probes.length >= current.options.probeLimit) {
    return reject(DecisionReason.RejectProbeLimit, current);
  }
  const probe = allocateProbe(current);
  const admitted = nextState(current, {
    probes: current.probes.concat([probe]),
    nextProbe: probe + 1
  });
  return allow(DecisionReason.AllowProbe, admitted, probe);
}

function recordClosed(current, nowMs, failed) {
  if (current.options.mode === TripMode.Consecutive) {
    return recordConsecutive(current, nowMs, failed);
  }
  return recordRate(current, nowMs, failed);
}

function recordConsecutive(current, nowMs, failed) {
  if (!failed) {
    return nextState(current, { consecutiveFailures: 0 });
  }
  const consecutiveFailures = current.consecutiveFailures + 1;
  if (consecutiveFailures >= current.options.failureThreshold) {
    return trip(current, nowMs);
  }
  return nextState(current, { consecutiveFailures });
}

function recordRate(current, nowMs, failed) {
  const outcome = failed ? Outcome.Failure : Outcome.Success;
  const outcomes = pushOutcome(current.outcomes, outcome, current.options.windowSize);
  if (rateTripped(outcomes, current.options)) {
    return trip(current, nowMs);
  }
  return nextState(current, { outcomes });
}

function recordProbe(current, nowMs, probe, failed) {
  const probes = removeProbe(current.probes, probe);
  if (probes == null) {
    throw new RangeError("probe does not match an admitted probe");
  }
  if (failed) {
    return trip(current, nowMs);
  }
  const consecutiveProbeSuccesses = current.consecutiveProbeSuccesses + 1;
  if (consecutiveProbeSuccesses >= current.options.probeSuccesses) {
    return closeBreaker(current);
  }
  return nextState(current, {
    probes,
    consecutiveProbeSuccesses
  });
}

function trip(current, nowMs) {
  const trips = nextTripCount(current);
  return nextState(current, {
    state: CircuitState.Open,
    consecutiveFailures: 0,
    consecutiveProbeSuccesses: 0,
    outcomes: [],
    openedAtMs: nowMs,
    openForMs: openDuration(current.options, trips),
    trips,
    probes: []
  });
}

function closeBreaker(current) {
  return nextState(current, {
    state: CircuitState.Closed,
    consecutiveFailures: 0,
    consecutiveProbeSuccesses: 0,
    outcomes: [],
    openedAtMs: null,
    openForMs: null,
    trips: 0,
    probes: []
  });
}

function removeProbe(probes, probe) {
  if (probe === null) {
    return null;
  }
  const next = [];
  let found = false;
  for (const id of probes) {
    if (id === probe && !found) {
      found = true;
      continue;
    }
    next.push(id);
  }
  if (!found) {
    return null;
  }
  return next;
}

function allocateProbe(current) {
  if (current.nextProbe === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("state.nextProbe cannot increase past the safe integer range");
  }
  return current.nextProbe;
}

function nextTripCount(current) {
  if (current.trips === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("state.trips cannot increase past the safe integer range");
  }
  return current.trips + 1;
}

function allow(reason, state, probe) {
  return decide(true, reason, state, probe);
}

function reject(reason, current) {
  return decide(false, reason, nextState(current, {}), null);
}

function decide(allowed, reason, state, probe) {
  return Object.freeze({
    allowed,
    reason,
    probe,
    state
  });
}

function assertNow(nowMs) {
  if (typeof nowMs !== "number") {
    throw new TypeError("nowMs must be a number");
  }
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError("nowMs must be a finite number greater than or equal to 0");
  }
}

function assertProbe(probe) {
  if (probe === null) {
    return;
  }
  if (typeof probe !== "number") {
    throw new TypeError("probe must be null or a positive safe integer");
  }
  if (!Number.isSafeInteger(probe) || probe < 1) {
    throw new RangeError("probe must be null or a positive safe integer");
  }
}
