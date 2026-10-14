import assert from "node:assert/strict";
import test from "node:test";
import {
  CIRCUIT_STATES,
  CircuitState,
  DECISION_FIELDS,
  DECISION_REASONS,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_FAILURE_RATE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MAX_OPEN_MS,
  DEFAULT_MINIMUM_CALLS,
  DEFAULT_OPEN_MS,
  DEFAULT_PROBE_LIMIT,
  DEFAULT_PROBE_SUCCESSES,
  DEFAULT_WINDOW_SIZE,
  DecisionReason,
  OPTION_FIELDS,
  OUTCOMES,
  Outcome,
  STATE_FIELDS,
  TRIP_MODES,
  TripMode,
  createBreaker
} from "../src/index.js";

const defaults = {
  mode: TripMode.Consecutive,
  failureThreshold: DEFAULT_FAILURE_THRESHOLD,
  failureRate: DEFAULT_FAILURE_RATE,
  windowSize: DEFAULT_WINDOW_SIZE,
  minimumCalls: DEFAULT_MINIMUM_CALLS,
  openMs: DEFAULT_OPEN_MS,
  probeLimit: DEFAULT_PROBE_LIMIT,
  probeSuccesses: DEFAULT_PROBE_SUCCESSES,
  backoffMultiplier: DEFAULT_BACKOFF_MULTIPLIER,
  maxOpenMs: DEFAULT_MAX_OPEN_MS
};

function expectError(run, name, message) {
  if (message === undefined) {
    assert.throws(run, { name });
    return;
  }
  assert.throws(run, { name, message });
}

test("named defaults are the documented thresholds", () => {
  assert.equal(DEFAULT_FAILURE_THRESHOLD, 5);
  assert.equal(DEFAULT_FAILURE_RATE, 0.5);
  assert.equal(DEFAULT_WINDOW_SIZE, 10);
  assert.equal(DEFAULT_MINIMUM_CALLS, 10);
  assert.equal(DEFAULT_OPEN_MS, 30000);
  assert.equal(DEFAULT_PROBE_LIMIT, 1);
  assert.equal(DEFAULT_PROBE_SUCCESSES, 1);
  assert.equal(DEFAULT_BACKOFF_MULTIPLIER, 1);
  assert.equal(DEFAULT_MAX_OPEN_MS, 300000);
});

test("state, mode, outcome, and reason enums are frozen", () => {
  assert.deepEqual(CIRCUIT_STATES, ["closed", "open", "half-open"]);
  assert.equal(CircuitState.Closed, "closed");
  assert.equal(CircuitState.Open, "open");
  assert.equal(CircuitState.HalfOpen, "half-open");
  assert.deepEqual(TRIP_MODES, ["consecutive", "rate"]);
  assert.equal(TripMode.Consecutive, "consecutive");
  assert.equal(TripMode.Rate, "rate");
  assert.deepEqual(OUTCOMES, ["success", "failure"]);
  assert.equal(Outcome.Success, "success");
  assert.equal(Outcome.Failure, "failure");
  assert.deepEqual(DECISION_REASONS, ["allow", "reject-open", "allow-probe", "reject-probe-limit"]);
  assert.equal(DecisionReason.Allow, "allow");
  assert.equal(DecisionReason.RejectOpen, "reject-open");
  assert.equal(DecisionReason.AllowProbe, "allow-probe");
  assert.equal(DecisionReason.RejectProbeLimit, "reject-probe-limit");
  for (const value of [
    CircuitState,
    CIRCUIT_STATES,
    TripMode,
    TRIP_MODES,
    Outcome,
    OUTCOMES,
    DecisionReason,
    DECISION_REASONS,
    OPTION_FIELDS,
    STATE_FIELDS,
    DECISION_FIELDS
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
  expectError(() => {
    CircuitState.Closed = "open";
  }, "TypeError");
  expectError(() => {
    DecisionReason.Allow = "nope";
  }, "TypeError");
});

test("createBreaker with no options stores every default", () => {
  const omitted = createBreaker();
  const empty = createBreaker({});
  const explicit = createBreaker(undefined);
  assert.deepEqual(omitted.options, defaults);
  assert.deepEqual(empty.options, defaults);
  assert.deepEqual(explicit.options, defaults);
  assert.deepEqual(Object.keys(omitted), [...STATE_FIELDS]);
  assert.deepEqual(Object.keys(omitted.options), [...OPTION_FIELDS]);
  assert.equal(omitted.state, CircuitState.Closed);
  assert.equal(omitted.consecutiveFailures, 0);
  assert.equal(omitted.consecutiveProbeSuccesses, 0);
  assert.deepEqual(omitted.outcomes, []);
  assert.equal(omitted.openedAtMs, null);
  assert.equal(omitted.openForMs, null);
  assert.equal(omitted.trips, 0);
  assert.equal(omitted.nextProbe, 1);
  assert.deepEqual(omitted.probes, []);
});

test("a larger window keeps the default minimum call count", () => {
  const breaker = createBreaker({ windowSize: 20 });
  assert.equal(breaker.options.windowSize, 20);
  assert.equal(breaker.options.minimumCalls, DEFAULT_MINIMUM_CALLS);
});

test("an open interval above the default cap raises the stored cap to match", () => {
  const openMs = DEFAULT_MAX_OPEN_MS + 1;
  const breaker = createBreaker({ openMs });
  assert.equal(breaker.options.openMs, openMs);
  assert.equal(breaker.options.maxOpenMs, openMs);
});

test("equal maxOpenMs and openMs is a fixed open interval", () => {
  const breaker = createBreaker({ openMs: 40, maxOpenMs: 40 });
  assert.equal(breaker.options.openMs, 40);
  assert.equal(breaker.options.maxOpenMs, 40);
});

test("zero openMs and a fractional openMs are finite durations", () => {
  assert.equal(createBreaker({ openMs: 0 }).options.openMs, 0);
  assert.equal(createBreaker({ openMs: 0.5 }).options.openMs, 0.5);
});

test("the caller's options object stays writable and unshared", () => {
  const options = { failureThreshold: 2 };
  const breaker = createBreaker(options);
  options.failureThreshold = 9;
  options.extra = true;
  assert.equal(Object.isFrozen(options), false);
  assert.equal(breaker.options.failureThreshold, 2);
  assert.equal(Object.hasOwn(breaker.options, "extra"), false);
  assert.equal(Object.isFrozen(breaker), true);
  assert.equal(Object.isFrozen(breaker.options), true);
  assert.equal(Object.isFrozen(breaker.outcomes), true);
  assert.equal(Object.isFrozen(breaker.probes), true);
  expectError(() => {
    breaker.consecutiveFailures = 1;
  }, "TypeError");
});

test("options must be a plain object", () => {
  expectError(() => createBreaker(null), "TypeError", "options must be an object");
  expectError(() => createBreaker([]), "TypeError", "options must be an object");
  expectError(() => createBreaker("consecutive"), "TypeError", "options must be an object");
  expectError(() => createBreaker(1), "TypeError", "options must be an object");
});

test("an unknown option is rejected", () => {
  expectError(() => createBreaker({ speed: 1 }), "TypeError", 'unknown option "speed"');
  expectError(() => createBreaker({ Mode: TripMode.Rate }), "TypeError", 'unknown option "Mode"');
});

test("mode must be a trip mode", () => {
  expectError(
    () => createBreaker({ mode: "Consecutive" }),
    "TypeError",
    "options.mode must be a trip mode"
  );
  expectError(() => createBreaker({ mode: "" }), "TypeError", "options.mode must be a trip mode");
  expectError(() => createBreaker({ mode: null }), "TypeError", "options.mode must be a trip mode");
  expectError(() => createBreaker({ mode: 1 }), "TypeError", "options.mode must be a trip mode");
  assert.equal(createBreaker({ mode: TripMode.Rate }).options.mode, TripMode.Rate);
  assert.equal(createBreaker({ mode: TripMode.Consecutive }).options.mode, TripMode.Consecutive);
});

test("count options must be positive safe integers", () => {
  const fields = ["failureThreshold", "windowSize", "minimumCalls", "probeLimit", "probeSuccesses"];
  function withOption(field, value) {
    const options = { windowSize: 10, minimumCalls: 1 };
    options[field] = value;
    return options;
  }
  for (const field of fields) {
    for (const value of [
      0,
      1.5,
      -1,
      Number.POSITIVE_INFINITY,
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      expectError(
        () => createBreaker(withOption(field, value)),
        "RangeError",
        `options.${field} must be a positive safe integer`
      );
    }
    for (const value of ["2", null]) {
      expectError(
        () => createBreaker(withOption(field, value)),
        "TypeError",
        `options.${field} must be a positive safe integer`
      );
    }
  }
  const breaker = createBreaker({ failureThreshold: Number.MAX_SAFE_INTEGER });
  assert.equal(breaker.options.failureThreshold, Number.MAX_SAFE_INTEGER);
});

test("a window smaller than the default minimum must set minimumCalls", () => {
  expectError(
    () => createBreaker({ windowSize: 5 }),
    "RangeError",
    "options.minimumCalls must be less than or equal to options.windowSize"
  );
  expectError(
    () => createBreaker({ windowSize: 4, minimumCalls: 5 }),
    "RangeError",
    "options.minimumCalls must be less than or equal to options.windowSize"
  );
  assert.equal(createBreaker({ windowSize: 5, minimumCalls: 5 }).options.minimumCalls, 5);
  assert.equal(createBreaker({ windowSize: 5, minimumCalls: 1 }).options.minimumCalls, 1);
});

test("failureRate must sit in the open-closed unit interval", () => {
  const message = "options.failureRate must be a finite number greater than 0 and at most 1";
  expectError(() => createBreaker({ failureRate: 0 }), "RangeError", message);
  expectError(() => createBreaker({ failureRate: -0.1 }), "RangeError", message);
  expectError(() => createBreaker({ failureRate: 1.0000001 }), "RangeError", message);
  expectError(() => createBreaker({ failureRate: Number.NaN }), "RangeError", message);
  expectError(
    () => createBreaker({ failureRate: Number.POSITIVE_INFINITY }),
    "RangeError",
    message
  );
  expectError(() => createBreaker({ failureRate: "0.5" }), "TypeError", message);
  expectError(() => createBreaker({ failureRate: null }), "TypeError", message);
  assert.equal(createBreaker({ failureRate: 1 }).options.failureRate, 1);
  assert.equal(
    createBreaker({ failureRate: Number.MIN_VALUE }).options.failureRate,
    Number.MIN_VALUE
  );
});

test("openMs must be a finite non-negative number", () => {
  const message = "options.openMs must be a finite number greater than or equal to 0";
  expectError(() => createBreaker({ openMs: -1 }), "RangeError", message);
  expectError(() => createBreaker({ openMs: Number.NaN }), "RangeError", message);
  expectError(() => createBreaker({ openMs: Number.NEGATIVE_INFINITY }), "RangeError", message);
  expectError(() => createBreaker({ openMs: "30" }), "TypeError", message);
  expectError(() => createBreaker({ openMs: null }), "TypeError", message);
});

test("backoffMultiplier must be a finite number at least 1", () => {
  const message = "options.backoffMultiplier must be a finite number greater than or equal to 1";
  expectError(() => createBreaker({ backoffMultiplier: 0.999 }), "RangeError", message);
  expectError(() => createBreaker({ backoffMultiplier: 0 }), "RangeError", message);
  expectError(
    () => createBreaker({ backoffMultiplier: Number.POSITIVE_INFINITY }),
    "RangeError",
    message
  );
  expectError(() => createBreaker({ backoffMultiplier: Number.NaN }), "RangeError", message);
  expectError(() => createBreaker({ backoffMultiplier: "2" }), "TypeError", message);
  assert.equal(createBreaker({ backoffMultiplier: 1.5 }).options.backoffMultiplier, 1.5);
});

test("maxOpenMs must be finite and at least openMs", () => {
  const message =
    "options.maxOpenMs must be a finite number greater than or equal to options.openMs";
  expectError(() => createBreaker({ openMs: 100, maxOpenMs: 99 }), "RangeError", message);
  expectError(() => createBreaker({ openMs: 100, maxOpenMs: -1 }), "RangeError", message);
  expectError(() => createBreaker({ maxOpenMs: Number.NaN }), "RangeError", message);
  expectError(() => createBreaker({ maxOpenMs: Number.POSITIVE_INFINITY }), "RangeError", message);
  expectError(() => createBreaker({ maxOpenMs: "300000" }), "TypeError", message);
  expectError(() => createBreaker({ maxOpenMs: null }), "TypeError", message);
});
