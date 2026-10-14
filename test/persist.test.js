import assert from "node:assert/strict";
import test from "node:test";
import {
  CircuitState,
  Outcome,
  TripMode,
  canPass,
  createBreaker,
  recordFailure
} from "../src/index.js";

function expectError(run, name, message) {
  assert.throws(run, { name, message });
}

function edited(breaker, edit) {
  const copy = JSON.parse(JSON.stringify(breaker));
  edit(copy);
  return copy;
}

function openedBreaker() {
  const decision = canPass(createBreaker({ failureThreshold: 1, openMs: 100 }), 20);
  return recordFailure(decision.state, 20, null);
}

function halfOpenBreaker() {
  const opened = openedBreaker();
  return canPass(opened, 120).state;
}

function wideHalfOpenBreaker() {
  const decision = canPass(createBreaker({ failureThreshold: 1, openMs: 0, probeLimit: 3 }), 0);
  const opened = recordFailure(decision.state, 0, null);
  return canPass(opened, 0).state;
}

test("a persisted breaker accepts the same calls as the live object", () => {
  const opened = openedBreaker();
  const restored = JSON.parse(JSON.stringify(opened));
  assert.equal(canPass(restored, 119).allowed, false);
  const decision = canPass(restored, 120);
  assert.equal(decision.state.state, CircuitState.HalfOpen);
  assert.equal(Object.isFrozen(decision.state), true);
});

test("state must be an object with the known fields", () => {
  expectError(() => canPass(null, 0), "TypeError", "state must be an object");
  expectError(() => canPass(undefined, 0), "TypeError", "state must be an object");
  expectError(() => canPass([], 0), "TypeError", "state must be an object");
  expectError(() => canPass("closed", 0), "TypeError", "state must be an object");
  expectError(
    () =>
      canPass(
        edited(createBreaker(), (copy) => {
          copy.extra = 1;
        }),
        0
      ),
    "TypeError",
    'unknown state field "extra"'
  );
  expectError(
    () =>
      canPass(
        edited(createBreaker(), (copy) => {
          delete copy.consecutiveFailures;
        }),
        0
      ),
    "TypeError",
    "state.consecutiveFailures is required"
  );
  const missing = edited(createBreaker(), (copy) => {
    delete copy.nextProbe;
  });
  expectError(() => canPass(missing, 0), "TypeError", "state.nextProbe is required");
});

test("the circuit state name is required", () => {
  expectError(
    () =>
      canPass(
        edited(createBreaker(), (copy) => {
          copy.state = "Closed";
        }),
        0
      ),
    "TypeError",
    "state.state must be a breaker state"
  );
  expectError(
    () =>
      canPass(
        edited(createBreaker(), (copy) => {
          copy.state = 1;
        }),
        0
      ),
    "TypeError",
    "state.state must be a breaker state"
  );
});

test("counters must be non-negative safe integers", () => {
  const fields = ["consecutiveFailures", "consecutiveProbeSuccesses", "trips"];
  for (const field of fields) {
    expectError(
      () =>
        canPass(
          edited(createBreaker(), (copy) => {
            copy[field] = "0";
          }),
          0
        ),
      "TypeError",
      `state.${field} must be a non-negative safe integer`
    );
    expectError(
      () =>
        canPass(
          edited(createBreaker(), (copy) => {
            copy[field] = -1;
          }),
          0
        ),
      "RangeError",
      `state.${field} must be a non-negative safe integer`
    );
    expectError(
      () =>
        canPass(
          edited(createBreaker(), (copy) => {
            copy[field] = 1.5;
          }),
          0
        ),
      "RangeError",
      `state.${field} must be a non-negative safe integer`
    );
  }
});

test("closed state rejects open bookkeeping", () => {
  const breaker = createBreaker();
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.trips = 1;
        }),
        0
      ),
    "RangeError",
    "state.trips must be 0 while the breaker is closed"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.openedAtMs = 0;
        }),
        0
      ),
    "RangeError",
    "state.openedAtMs must be null while the breaker is closed"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.openForMs = 0;
        }),
        0
      ),
    "RangeError",
    "state.openForMs must be null while the breaker is closed"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.probes = [1];
          copy.nextProbe = 2;
        }),
        0
      ),
    "RangeError",
    "state.probes must be empty unless the breaker is half-open"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.consecutiveProbeSuccesses = 1;
        }),
        0
      ),
    "RangeError",
    "state.consecutiveProbeSuccesses must be 0 unless the breaker is half-open"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.consecutiveFailures = 5;
        }),
        0
      ),
    "RangeError",
    "state.consecutiveFailures must be below options.failureThreshold"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.outcomes = [Outcome.Failure];
        }),
        0
      ),
    "RangeError",
    "state.outcomes must be empty in consecutive mode"
  );
});

test("open state requires a matching duration and an empty window", () => {
  const opened = openedBreaker();
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.trips = 0;
        }),
        0
      ),
    "RangeError",
    "state.trips must be a positive safe integer while the breaker is not closed"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.openedAtMs = null;
        }),
        0
      ),
    "TypeError",
    "state.openedAtMs must be a finite number greater than or equal to 0"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.openedAtMs = -1;
        }),
        0
      ),
    "RangeError",
    "state.openedAtMs must be a finite number greater than or equal to 0"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.openedAtMs = Number.NaN;
        }),
        0
      ),
    "RangeError",
    "state.openedAtMs must be a finite number greater than or equal to 0"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.openForMs = null;
        }),
        0
      ),
    "TypeError",
    "state.openForMs must be a finite number greater than or equal to 0"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.openForMs = -1;
        }),
        0
      ),
    "RangeError",
    "state.openForMs must be a finite number greater than or equal to 0"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.openForMs = 99;
        }),
        0
      ),
    "RangeError",
    "state.openForMs does not match the open duration for state.trips"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.outcomes = [Outcome.Success];
        }),
        0
      ),
    "RangeError",
    "state.outcomes must be empty unless the breaker is closed"
  );
  expectError(
    () =>
      canPass(
        edited(opened, (copy) => {
          copy.consecutiveFailures = 1;
        }),
        0
      ),
    "RangeError",
    "state.consecutiveFailures must be 0 unless the breaker is closed in consecutive mode"
  );
});

test("half-open probe ids are a strictly increasing set under the limit", () => {
  const half = halfOpenBreaker();
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.probes = "1";
        }),
        0
      ),
    "TypeError",
    "state.probes must be an array of positive safe integers"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.probes = [1, 2];
          copy.nextProbe = 3;
        }),
        0
      ),
    "RangeError",
    "state.probes must contain at most options.probeLimit ids"
  );
  const wide = wideHalfOpenBreaker();
  expectError(
    () =>
      canPass(
        edited(wide, (copy) => {
          copy.probes = [1, 1];
          copy.nextProbe = 3;
        }),
        0
      ),
    "RangeError",
    "state.probes must be strictly increasing"
  );
  expectError(
    () =>
      canPass(
        edited(wide, (copy) => {
          copy.probes = [2, 1];
          copy.nextProbe = 3;
        }),
        0
      ),
    "RangeError",
    "state.probes must be strictly increasing"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.probes = [0];
        }),
        0
      ),
    "RangeError",
    "state.probes must be an array of positive safe integers"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.probes = ["1"];
        }),
        0
      ),
    "TypeError",
    "state.probes must be an array of positive safe integers"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.probes = [1.5];
          copy.nextProbe = 2;
        }),
        0
      ),
    "RangeError",
    "state.probes must be an array of positive safe integers"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.probes = [5];
          copy.nextProbe = 5;
        }),
        0
      ),
    "RangeError",
    "each state.probes id must be less than state.nextProbe"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.consecutiveProbeSuccesses = 1;
        }),
        0
      ),
    "RangeError",
    "state.consecutiveProbeSuccesses must be below options.probeSuccesses"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.nextProbe = 0;
        }),
        0
      ),
    "RangeError",
    "state.nextProbe must be a positive safe integer"
  );
  expectError(
    () =>
      canPass(
        edited(half, (copy) => {
          copy.nextProbe = "2";
        }),
        0
      ),
    "TypeError",
    "state.nextProbe must be a positive safe integer"
  );
});

test("outcomes must be names inside the window and must not already trip", () => {
  const rated = createBreaker({
    mode: TripMode.Rate,
    windowSize: 2,
    minimumCalls: 1,
    failureRate: 1
  });
  expectError(
    () =>
      canPass(
        edited(rated, (copy) => {
          copy.outcomes = "failure";
        }),
        0
      ),
    "TypeError",
    "state.outcomes must be an array of outcome names"
  );
  expectError(
    () =>
      canPass(
        edited(rated, (copy) => {
          copy.outcomes = [true];
        }),
        0
      ),
    "TypeError",
    "state.outcomes must be an array of outcome names"
  );
  expectError(
    () =>
      canPass(
        edited(rated, (copy) => {
          copy.outcomes = [Outcome.Failure, Outcome.Success, Outcome.Failure];
        }),
        0
      ),
    "RangeError",
    "state.outcomes must not be longer than options.windowSize"
  );
  expectError(
    () =>
      canPass(
        edited(rated, (copy) => {
          copy.outcomes = [Outcome.Failure];
        }),
        0
      ),
    "RangeError",
    "state.outcomes already meets the failure rate"
  );
  expectError(
    () =>
      canPass(
        edited(rated, (copy) => {
          copy.consecutiveFailures = 1;
        }),
        0
      ),
    "RangeError",
    "state.consecutiveFailures must be 0 unless the breaker is closed in consecutive mode"
  );
});

test("stored options are complete and still validated", () => {
  const breaker = createBreaker();
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.options = null;
        }),
        0
      ),
    "TypeError",
    "state.options must be an object"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.options = [];
        }),
        0
      ),
    "TypeError",
    "state.options must be an object"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          delete copy.options.mode;
        }),
        0
      ),
    "TypeError",
    "state.options.mode is required"
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.options.speed = 1;
        }),
        0
      ),
    "TypeError",
    'unknown option "speed"'
  );
  expectError(
    () =>
      canPass(
        edited(breaker, (copy) => {
          copy.options.failureThreshold = 0;
        }),
        0
      ),
    "RangeError",
    "options.failureThreshold must be a positive safe integer"
  );
});

test("a hand-built half-open state with no probes can admit one", () => {
  const half = edited(halfOpenBreaker(), (copy) => {
    copy.probes = [];
    copy.consecutiveProbeSuccesses = 0;
  });
  const decision = canPass(half, 0);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "allow-probe");
  assert.deepEqual(decision.state.probes, [decision.probe]);
});
