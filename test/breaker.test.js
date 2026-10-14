import assert from "node:assert/strict";
import test from "node:test";
import {
  CircuitState,
  DECISION_FIELDS,
  DecisionReason,
  Outcome,
  TripMode,
  canPass,
  createBreaker,
  recordFailure,
  recordSuccess
} from "../src/index.js";

function expectError(run, name, message) {
  assert.throws(run, { name, message });
}

function fail(breaker, nowMs) {
  const decision = canPass(breaker, nowMs);
  assert.equal(decision.allowed, true);
  return recordFailure(decision.state, nowMs, decision.probe);
}

function succeed(breaker, nowMs) {
  const decision = canPass(breaker, nowMs);
  assert.equal(decision.allowed, true);
  return recordSuccess(decision.state, nowMs, decision.probe);
}

test("the usage sample trips, backs off, and closes", () => {
  let breaker = createBreaker({
    failureThreshold: 2,
    openMs: 1000,
    probeSuccesses: 2,
    backoffMultiplier: 2,
    maxOpenMs: 8000
  });

  const first = canPass(breaker, 0);
  assert.equal(first.allowed, true);
  assert.equal(first.reason, DecisionReason.Allow);
  assert.equal(first.probe, null);
  assert.deepEqual(Object.keys(first), [...DECISION_FIELDS]);
  breaker = recordFailure(first.state, 0, first.probe);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.equal(breaker.consecutiveFailures, 1);

  const second = canPass(breaker, 10);
  breaker = recordFailure(second.state, 10, second.probe);
  assert.equal(breaker.state, CircuitState.Open);
  assert.equal(breaker.openedAtMs, 10);
  assert.equal(breaker.openForMs, 1000);
  assert.equal(breaker.trips, 1);
  assert.equal(breaker.consecutiveFailures, 0);
  assert.deepEqual(breaker.probes, []);

  const refused = canPass(breaker, 1009);
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, DecisionReason.RejectOpen);
  assert.equal(refused.probe, null);
  assert.equal(refused.state.state, CircuitState.Open);
  assert.equal(Object.isFrozen(refused), true);

  const probe = canPass(breaker, 1010);
  assert.equal(probe.allowed, true);
  assert.equal(probe.reason, DecisionReason.AllowProbe);
  assert.equal(probe.probe, 1);
  assert.equal(probe.state.state, CircuitState.HalfOpen);
  assert.deepEqual(probe.state.probes, [1]);
  breaker = recordFailure(probe.state, 1010, probe.probe);
  assert.equal(breaker.state, CircuitState.Open);
  assert.equal(breaker.openedAtMs, 1010);
  assert.equal(breaker.openForMs, 2000);
  assert.equal(breaker.trips, 2);

  const early = canPass(breaker, 3009);
  assert.equal(early.allowed, false);
  assert.equal(early.reason, DecisionReason.RejectOpen);

  const next = canPass(breaker, 3010);
  assert.equal(next.probe, 2);
  breaker = recordSuccess(next.state, 3010, next.probe);
  assert.equal(breaker.state, CircuitState.HalfOpen);
  assert.equal(breaker.consecutiveProbeSuccesses, 1);
  assert.deepEqual(breaker.probes, []);
  assert.equal(breaker.openedAtMs, 1010);
  assert.equal(breaker.trips, 2);

  const again = canPass(breaker, 3010);
  assert.equal(again.reason, DecisionReason.AllowProbe);
  assert.equal(again.probe, 3);
  breaker = recordSuccess(again.state, 3010, again.probe);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.equal(breaker.trips, 0);
  assert.equal(breaker.openedAtMs, null);
  assert.equal(breaker.openForMs, null);
  assert.equal(breaker.consecutiveFailures, 0);
  assert.equal(breaker.consecutiveProbeSuccesses, 0);
  assert.deepEqual(breaker.outcomes, []);
  assert.deepEqual(breaker.probes, []);
  assert.equal(breaker.nextProbe, 4);
});

test("a closed call is allowed and a new state is returned", () => {
  const breaker = createBreaker();
  const decision = canPass(breaker, 0);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, DecisionReason.Allow);
  assert.equal(decision.probe, null);
  assert.notEqual(decision.state, breaker);
  assert.deepEqual(decision.state, breaker);
  assert.equal(decision.state.consecutiveFailures, 0);
  const later = canPass(decision.state, 50);
  assert.deepEqual(later.state, breaker);
});

test("consecutive failures trip at the threshold and a success clears the streak", () => {
  let breaker = createBreaker({ failureThreshold: 3, failureRate: 0.01 });
  breaker = fail(breaker, 1);
  breaker = fail(breaker, 2);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.equal(breaker.consecutiveFailures, 2);
  assert.deepEqual(breaker.outcomes, []);
  breaker = succeed(breaker, 3);
  assert.equal(breaker.consecutiveFailures, 0);
  breaker = fail(breaker, 4);
  breaker = fail(breaker, 5);
  assert.equal(breaker.state, CircuitState.Closed);
  breaker = fail(breaker, 6);
  assert.equal(breaker.state, CircuitState.Open);
  assert.equal(breaker.openedAtMs, 6);
  assert.equal(breaker.consecutiveFailures, 0);
});

test("a threshold of one opens on the first failure", () => {
  const breaker = createBreaker({ failureThreshold: 1, openMs: 250 });
  const opened = fail(breaker, 40);
  assert.equal(opened.state, CircuitState.Open);
  assert.equal(opened.openForMs, 250);
  assert.equal(opened.openedAtMs, 40);
});

test("the trip is stamped with the record time", () => {
  const breaker = createBreaker({ failureThreshold: 1 });
  const decision = canPass(breaker, 10);
  const opened = recordFailure(decision.state, 25, null);
  assert.equal(opened.openedAtMs, 25);
});

test("successes alone leave a consecutive breaker closed", () => {
  let breaker = createBreaker({ failureThreshold: 1 });
  breaker = succeed(breaker, 0);
  breaker = succeed(breaker, 1);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.equal(breaker.consecutiveFailures, 0);
});

test("open refuses until the open interval has elapsed", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 1000 }), 500);
  const before = canPass(opened, 1499);
  assert.equal(before.allowed, false);
  assert.equal(before.reason, DecisionReason.RejectOpen);
  assert.equal(before.state.openForMs, 1000);
  const at = canPass(opened, 1500);
  assert.equal(at.allowed, true);
  assert.equal(at.reason, DecisionReason.AllowProbe);
  assert.equal(at.state.state, CircuitState.HalfOpen);
  const after = canPass(before.state, 1500);
  assert.equal(after.allowed, true);
});

test("a zero open interval half-opens on the trip timestamp", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 0 }), 80);
  assert.equal(opened.openForMs, 0);
  const same = canPass(opened, 80);
  assert.equal(same.allowed, true);
  assert.equal(same.state.state, CircuitState.HalfOpen);
});

test("a fractional open interval uses the exact boundary", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 0.5 }), 0);
  assert.equal(opened.openForMs, 0.5);
  assert.equal(canPass(opened, 0.49).allowed, false);
  assert.equal(canPass(opened, 0.5).allowed, true);
});

test("a clock earlier than the trip stays open", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 0 }), 1000);
  assert.equal(canPass(opened, 999).allowed, false);
  assert.equal(canPass(opened, 999).reason, DecisionReason.RejectOpen);
  const slow = fail(createBreaker({ failureThreshold: 1, openMs: 1000 }), 1000);
  assert.equal(canPass(slow, 999).allowed, false);
});

test("the same open snapshot can be admitted twice because state is threaded by the caller", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 10 }), 0);
  const left = canPass(opened, 10);
  const right = canPass(opened, 10);
  assert.equal(left.probe, 1);
  assert.equal(right.probe, 1);
  assert.equal(opened.state, CircuitState.Open);
  const second = canPass(left.state, 10);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, DecisionReason.RejectProbeLimit);
});

test("half-open admits at most probeLimit probes", () => {
  const breaker = fail(
    createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 2, probeSuccesses: 3 }),
    0
  );
  const first = canPass(breaker, 0);
  const second = canPass(first.state, 0);
  const third = canPass(second.state, 0);
  assert.equal(first.probe, 1);
  assert.equal(second.probe, 2);
  assert.deepEqual(second.state.probes, [1, 2]);
  assert.equal(third.allowed, false);
  assert.equal(third.reason, DecisionReason.RejectProbeLimit);
  assert.equal(third.probe, null);
  assert.deepEqual(third.state.probes, [1, 2]);
  assert.equal(third.state.nextProbe, second.state.nextProbe);
  assert.notEqual(third.state, second.state);
});

test("a half-open breaker does not consult the open interval again", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 2 }), 1000);
  const first = canPass(opened, 1000);
  const early = canPass(first.state, 0);
  assert.equal(early.allowed, true);
  assert.equal(early.probe, 2);
});

test("probe successes close the breaker only when the streak is complete", () => {
  let breaker = fail(
    createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 1, probeSuccesses: 3 }),
    0
  );
  breaker = succeed(breaker, 0);
  assert.equal(breaker.state, CircuitState.HalfOpen);
  assert.equal(breaker.consecutiveProbeSuccesses, 1);
  assert.deepEqual(breaker.probes, []);
  breaker = succeed(breaker, 1);
  assert.equal(breaker.consecutiveProbeSuccesses, 2);
  breaker = succeed(breaker, 2);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.equal(breaker.consecutiveProbeSuccesses, 0);
  assert.equal(breaker.trips, 0);
});

test("one probe success closes when probeSuccesses is one", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 5 }), 0);
  const closed = succeed(opened, 5);
  assert.equal(closed.state, CircuitState.Closed);
  assert.equal(closed.nextProbe, 2);
});

test("any probe failure reopens and restarts the window", () => {
  let breaker = fail(
    createBreaker({
      failureThreshold: 1,
      openMs: 100,
      probeSuccesses: 3,
      backoffMultiplier: 1
    }),
    0
  );
  breaker = succeed(breaker, 100);
  breaker = succeed(breaker, 100);
  assert.equal(breaker.consecutiveProbeSuccesses, 2);
  breaker = fail(breaker, 150);
  assert.equal(breaker.state, CircuitState.Open);
  assert.equal(breaker.openedAtMs, 150);
  assert.equal(breaker.openForMs, 100);
  assert.equal(breaker.consecutiveProbeSuccesses, 0);
  assert.equal(breaker.trips, 2);
  assert.equal(canPass(breaker, 249).allowed, false);
  breaker = succeed(breaker, 250);
  assert.equal(breaker.state, CircuitState.HalfOpen);
  assert.equal(breaker.consecutiveProbeSuccesses, 1);
});

test("concurrent probes close together and a late probe cannot record", () => {
  const opened = fail(
    createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 2, probeSuccesses: 2 }),
    0
  );
  const first = canPass(opened, 0);
  const second = canPass(first.state, 0);
  const afterFirst = recordSuccess(second.state, 0, first.probe);
  assert.equal(afterFirst.state, CircuitState.HalfOpen);
  assert.deepEqual(afterFirst.probes, [2]);
  const closed = recordSuccess(afterFirst, 0, second.probe);
  assert.equal(closed.state, CircuitState.Closed);
  expectError(
    () => recordFailure(closed, 0, first.probe),
    "RangeError",
    "probe must be null while the breaker is closed"
  );
  assert.equal(closed.state, CircuitState.Closed);
});

test("a probe failure abandons every other in-flight probe", () => {
  const opened = fail(
    createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 3, probeSuccesses: 3 }),
    0
  );
  const first = canPass(opened, 0);
  const second = canPass(first.state, 0);
  const third = canPass(second.state, 0);
  const reopened = recordFailure(third.state, 40, second.probe);
  assert.equal(reopened.state, CircuitState.Open);
  assert.equal(reopened.openedAtMs, 40);
  assert.deepEqual(reopened.probes, []);
  expectError(
    () => recordSuccess(reopened, 40, first.probe),
    "RangeError",
    "cannot record an outcome while the breaker is open"
  );
  expectError(
    () => recordFailure(reopened, 40, third.probe),
    "RangeError",
    "cannot record an outcome while the breaker is open"
  );
});

test("removing the middle probe keeps the remaining ids", () => {
  const opened = fail(
    createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 3, probeSuccesses: 3 }),
    0
  );
  const first = canPass(opened, 0);
  const second = canPass(first.state, 0);
  const third = canPass(second.state, 0);
  const after = recordSuccess(third.state, 0, second.probe);
  assert.deepEqual(after.probes, [1, 3]);
  assert.equal(after.consecutiveProbeSuccesses, 1);
});

test("a probe id can be recorded once", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 0, probeSuccesses: 2 }), 0);
  const decision = canPass(opened, 0);
  const after = recordSuccess(decision.state, 0, decision.probe);
  expectError(
    () => recordSuccess(after, 0, decision.probe),
    "RangeError",
    "probe does not match an admitted probe"
  );
  expectError(
    () => recordFailure(decision.state, 0, 99),
    "RangeError",
    "probe does not match an admitted probe"
  );
  expectError(
    () => recordSuccess(decision.state, 0, null),
    "RangeError",
    "probe does not match an admitted probe"
  );
});

test("forked states do not observe each other's records", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 0 }), 0);
  const decision = canPass(opened, 0);
  const closed = recordSuccess(decision.state, 0, decision.probe);
  const reopened = recordFailure(decision.state, 5, decision.probe);
  assert.equal(closed.state, CircuitState.Closed);
  assert.equal(reopened.state, CircuitState.Open);
  assert.equal(reopened.openedAtMs, 5);
  assert.equal(decision.state.state, CircuitState.HalfOpen);
});

test("backoff doubles until the cap and a close starts again at openMs", () => {
  let breaker = createBreaker({
    failureThreshold: 1,
    openMs: 1000,
    backoffMultiplier: 2,
    maxOpenMs: 5000,
    probeSuccesses: 1
  });
  breaker = fail(breaker, 0);
  assert.equal(breaker.openForMs, 1000);
  assert.equal(canPass(breaker, 999).allowed, false);
  breaker = fail(breaker, 1000);
  assert.equal(breaker.openForMs, 2000);
  assert.equal(breaker.openedAtMs, 1000);
  assert.equal(canPass(breaker, 2999).allowed, false);
  breaker = fail(breaker, 3000);
  assert.equal(breaker.openForMs, 4000);
  breaker = fail(breaker, 7000);
  assert.equal(breaker.openForMs, 5000);
  assert.equal(breaker.trips, 4);
  breaker = fail(breaker, 12000);
  assert.equal(breaker.openForMs, 5000);
  assert.equal(breaker.trips, 5);
  breaker = succeed(breaker, 17000);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.equal(breaker.trips, 0);
  breaker = fail(breaker, 17000);
  assert.equal(breaker.openForMs, 1000);
  assert.equal(breaker.trips, 1);
});

test("a multiplier of one keeps the same open interval", () => {
  let breaker = createBreaker({
    failureThreshold: 1,
    openMs: 30,
    backoffMultiplier: 1,
    maxOpenMs: 1000
  });
  for (let trip = 0; trip < 5; trip += 1) {
    const now = trip * 30;
    breaker = fail(breaker, now);
    assert.equal(breaker.openForMs, 30);
    assert.equal(breaker.trips, trip + 1);
  }
});

test("a fractional multiplier grows the open interval", () => {
  let breaker = createBreaker({
    failureThreshold: 1,
    openMs: 1000,
    backoffMultiplier: 1.5,
    maxOpenMs: 10000
  });
  breaker = fail(breaker, 0);
  assert.equal(breaker.openForMs, 1000);
  breaker = fail(breaker, 1000);
  assert.equal(breaker.openForMs, 1500);
  breaker = fail(breaker, 2500);
  assert.equal(breaker.openForMs, 2250);
});

test("an overflowing backoff power uses maxOpenMs", () => {
  const opened = fail(
    createBreaker({
      failureThreshold: 1,
      openMs: 1,
      backoffMultiplier: 10,
      maxOpenMs: Number.MAX_VALUE
    }),
    0
  );
  const copy = JSON.parse(JSON.stringify(opened));
  copy.trips = 309;
  copy.openForMs = 1e308;
  copy.openedAtMs = 0;
  const decision = canPass(copy, 1e308);
  assert.equal(decision.allowed, true);
  const next = recordFailure(decision.state, 1e308, decision.probe);
  assert.equal(next.trips, 310);
  assert.equal(next.openForMs, Number.MAX_VALUE);
});

test("a rate window trips once the failure share reaches the threshold", () => {
  let breaker = createBreaker({
    mode: TripMode.Rate,
    failureThreshold: 1,
    windowSize: 4,
    minimumCalls: 4,
    failureRate: 0.5,
    openMs: 500
  });
  breaker = fail(breaker, 0);
  breaker = fail(breaker, 1);
  breaker = succeed(breaker, 2);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.deepEqual(breaker.outcomes, [Outcome.Failure, Outcome.Failure, Outcome.Success]);
  assert.equal(breaker.consecutiveFailures, 0);
  breaker = succeed(breaker, 3);
  assert.equal(breaker.state, CircuitState.Open);
  assert.equal(breaker.openedAtMs, 3);
  assert.equal(breaker.openForMs, 500);
  assert.deepEqual(breaker.outcomes, []);
});

test("a rate below the threshold stays closed and then slides", () => {
  let breaker = createBreaker({
    mode: TripMode.Rate,
    windowSize: 3,
    minimumCalls: 3,
    failureRate: 0.5
  });
  breaker = fail(breaker, 0);
  breaker = succeed(breaker, 1);
  breaker = succeed(breaker, 2);
  assert.deepEqual(breaker.outcomes, [Outcome.Failure, Outcome.Success, Outcome.Success]);
  breaker = fail(breaker, 3);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.deepEqual(breaker.outcomes, [Outcome.Success, Outcome.Success, Outcome.Failure]);
  breaker = fail(breaker, 4);
  assert.equal(breaker.state, CircuitState.Open);
  assert.deepEqual(breaker.outcomes, []);
});

test("a short sample cannot trip even when every call failed", () => {
  let breaker = createBreaker({
    mode: TripMode.Rate,
    windowSize: 4,
    minimumCalls: 4,
    failureRate: 0.5
  });
  breaker = fail(breaker, 0);
  breaker = fail(breaker, 1);
  breaker = fail(breaker, 2);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.equal(breaker.outcomes.length, 3);
});

test("failureRate of one requires a full window of failures", () => {
  let breaker = createBreaker({
    mode: TripMode.Rate,
    windowSize: 2,
    minimumCalls: 2,
    failureRate: 1
  });
  breaker = fail(breaker, 0);
  breaker = succeed(breaker, 1);
  assert.deepEqual(breaker.outcomes, [Outcome.Failure, Outcome.Success]);
  breaker = succeed(breaker, 2);
  assert.deepEqual(breaker.outcomes, [Outcome.Success, Outcome.Success]);
  breaker = fail(breaker, 3);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.deepEqual(breaker.outcomes, [Outcome.Success, Outcome.Failure]);
  breaker = fail(breaker, 4);
  assert.equal(breaker.state, CircuitState.Open);
});

test("two failures out of three trip at a rate of two thirds and not below it", () => {
  const below = createBreaker({
    mode: TripMode.Rate,
    windowSize: 3,
    minimumCalls: 3,
    failureRate: 0.67
  });
  let quiet = fail(below, 0);
  quiet = fail(quiet, 1);
  quiet = succeed(quiet, 2);
  assert.equal(quiet.state, CircuitState.Closed);

  const at = createBreaker({
    mode: TripMode.Rate,
    windowSize: 3,
    minimumCalls: 3,
    failureRate: 0.66
  });
  let noisy = fail(at, 0);
  noisy = fail(noisy, 1);
  noisy = succeed(noisy, 2);
  assert.equal(noisy.state, CircuitState.Open);
});

test("the oldest outcome leaves a full window", () => {
  let breaker = createBreaker({
    mode: TripMode.Rate,
    windowSize: 2,
    minimumCalls: 2,
    failureRate: 1
  });
  breaker = fail(breaker, 0);
  breaker = succeed(breaker, 1);
  breaker = succeed(breaker, 2);
  assert.deepEqual(breaker.outcomes, [Outcome.Success, Outcome.Success]);
});

test("a success that fills the minimum sample can trip", () => {
  let breaker = createBreaker({
    mode: TripMode.Rate,
    windowSize: 4,
    minimumCalls: 4,
    failureRate: 0.5
  });
  breaker = fail(breaker, 0);
  breaker = fail(breaker, 1);
  breaker = fail(breaker, 2);
  assert.equal(breaker.state, CircuitState.Closed);
  breaker = succeed(breaker, 3);
  assert.equal(breaker.state, CircuitState.Open);
});

test("closing clears the rate window", () => {
  let breaker = createBreaker({
    mode: TripMode.Rate,
    windowSize: 2,
    minimumCalls: 2,
    failureRate: 1,
    openMs: 0,
    probeSuccesses: 1
  });
  breaker = fail(breaker, 0);
  breaker = fail(breaker, 1);
  assert.equal(breaker.state, CircuitState.Open);
  breaker = succeed(breaker, 1);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.deepEqual(breaker.outcomes, []);
  breaker = fail(breaker, 2);
  assert.equal(breaker.state, CircuitState.Closed);
  assert.deepEqual(breaker.outcomes, [Outcome.Failure]);
});

test("a restored breaker keeps its policy and counters", () => {
  let breaker = createBreaker({ failureThreshold: 2, openMs: 15 });
  breaker = fail(breaker, 4);
  const restored = JSON.parse(JSON.stringify(breaker));
  const opened = fail(restored, 9);
  assert.equal(opened.state, CircuitState.Open);
  assert.equal(opened.options.failureThreshold, 2);
  assert.equal(opened.openForMs, 15);
  const again = JSON.parse(JSON.stringify(opened));
  assert.equal(canPass(again, 23).allowed, false);
  assert.equal(canPass(again, 24).reason, DecisionReason.AllowProbe);
});

test("nowMs and probe tokens are checked before a transition", () => {
  const breaker = createBreaker();
  const nowMessage = "nowMs must be a finite number greater than or equal to 0";
  for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    expectError(() => canPass(breaker, nowMs), "RangeError", nowMessage);
    expectError(() => recordSuccess(breaker, nowMs, null), "RangeError", nowMessage);
    expectError(() => recordFailure(breaker, nowMs, null), "RangeError", nowMessage);
  }
  for (const nowMs of ["0", null, undefined, true, {}]) {
    expectError(() => canPass(breaker, nowMs), "TypeError", "nowMs must be a number");
    expectError(() => recordFailure(breaker, nowMs, null), "TypeError", "nowMs must be a number");
  }
  const probeType = "probe must be null or a positive safe integer";
  expectError(() => recordSuccess(breaker, 0, undefined), "TypeError", probeType);
  expectError(() => recordFailure(breaker, 0, "1"), "TypeError", probeType);
  expectError(() => recordSuccess(breaker, 0, true), "TypeError", probeType);
  expectError(() => recordFailure(breaker, 0, 0), "RangeError", probeType);
  expectError(() => recordSuccess(breaker, 0, -1), "RangeError", probeType);
  expectError(() => recordFailure(breaker, 0, 1.5), "RangeError", probeType);
  expectError(() => recordSuccess(breaker, 0, Number.NaN), "RangeError", probeType);
  expectError(
    () => recordFailure(breaker, 0, 1),
    "RangeError",
    "probe must be null while the breaker is closed"
  );
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 100 }), 0);
  expectError(
    () => recordSuccess(opened, 0, null),
    "RangeError",
    "cannot record an outcome while the breaker is open"
  );
  expectError(
    () => recordFailure(opened, 50, 1),
    "RangeError",
    "cannot record an outcome while the breaker is open"
  );
});

test("a closed success still requires a finite clock and does not store it", () => {
  const breaker = fail(createBreaker({ failureThreshold: 3 }), 5);
  const closed = recordSuccess(breaker, 0, null);
  assert.equal(closed.openedAtMs, null);
  assert.equal(closed.consecutiveFailures, 0);
});

test("nextProbe and trips stop at the safe integer boundary", () => {
  const opened = fail(createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 2 }), 0);
  const admitted = canPass(opened, 0);
  const probeCopy = JSON.parse(JSON.stringify(admitted.state));
  probeCopy.nextProbe = Number.MAX_SAFE_INTEGER;
  expectError(
    () => canPass(probeCopy, 0),
    "RangeError",
    "state.nextProbe cannot increase past the safe integer range"
  );

  const tripped = fail(createBreaker({ failureThreshold: 1, openMs: 50 }), 0);
  const tripCopy = JSON.parse(JSON.stringify(tripped));
  tripCopy.trips = Number.MAX_SAFE_INTEGER;
  const decision = canPass(tripCopy, 50);
  expectError(
    () => recordFailure(decision.state, 50, decision.probe),
    "RangeError",
    "state.trips cannot increase past the safe integer range"
  );
});

test("input state is not mutated", () => {
  const breaker = createBreaker({
    mode: TripMode.Rate,
    windowSize: 4,
    minimumCalls: 4,
    failureRate: 1
  });
  const before = JSON.parse(JSON.stringify(breaker));
  const decision = canPass(breaker, 10);
  const next = recordFailure(decision.state, 10, null);
  assert.deepEqual(breaker, before);
  assert.equal(breaker.outcomes.length, 0);
  assert.deepEqual(next.outcomes, [Outcome.Failure]);
  assert.notEqual(next.outcomes, breaker.outcomes);
  assert.notEqual(next.options, breaker.options);
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.isFrozen(next.outcomes), true);
});
