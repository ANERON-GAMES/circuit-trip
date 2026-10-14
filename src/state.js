import { CIRCUIT_STATES, CircuitState, OUTCOMES, STATE_FIELDS, TripMode } from "./constants.js";
import { openDuration } from "./duration.js";
import { freezeOptions, readStoredOptions, resolveOptions } from "./options.js";
import { rateTripped } from "./window.js";

export function createBreaker(options) {
  const resolved = resolveOptions(options);
  return freezeState({
    state: CircuitState.Closed,
    consecutiveFailures: 0,
    consecutiveProbeSuccesses: 0,
    outcomes: [],
    openedAtMs: null,
    openForMs: null,
    trips: 0,
    nextProbe: 1,
    probes: [],
    options: resolved
  });
}

export function readState(value) {
  if (!isRecord(value)) {
    throw new TypeError("state must be an object");
  }
  rejectUnknown(value, STATE_FIELDS);
  for (const field of STATE_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      throw new TypeError(`state.${field} is required`);
    }
  }
  const options = readStoredOptions(value.options);
  const circuitState = readCircuitState(value.state);
  const consecutiveFailures = readCount(value.consecutiveFailures, "state.consecutiveFailures");
  const consecutiveProbeSuccesses = readCount(
    value.consecutiveProbeSuccesses,
    "state.consecutiveProbeSuccesses"
  );
  const outcomes = readOutcomes(value.outcomes, circuitState, options);
  const trips = readTrips(value.trips, circuitState);
  const openedAtMs = readOpenedAt(value.openedAtMs, circuitState);
  const openForMs = readOpenFor(value.openForMs, circuitState, options, trips);
  const nextProbe = readNextProbe(value.nextProbe);
  const probes = readProbes(value.probes, circuitState, nextProbe, options);
  assertCounters(circuitState, options, consecutiveFailures, consecutiveProbeSuccesses);
  return freezeState({
    state: circuitState,
    consecutiveFailures,
    consecutiveProbeSuccesses,
    outcomes,
    openedAtMs,
    openForMs,
    trips,
    nextProbe,
    probes,
    options
  });
}

export function nextState(current, changes) {
  return readState({
    state: pick(changes, "state", current.state),
    consecutiveFailures: pick(changes, "consecutiveFailures", current.consecutiveFailures),
    consecutiveProbeSuccesses: pick(
      changes,
      "consecutiveProbeSuccesses",
      current.consecutiveProbeSuccesses
    ),
    outcomes: pick(changes, "outcomes", current.outcomes),
    openedAtMs: pick(changes, "openedAtMs", current.openedAtMs),
    openForMs: pick(changes, "openForMs", current.openForMs),
    trips: pick(changes, "trips", current.trips),
    nextProbe: pick(changes, "nextProbe", current.nextProbe),
    probes: pick(changes, "probes", current.probes),
    options: current.options
  });
}

function pick(changes, field, fallback) {
  if (Object.hasOwn(changes, field)) {
    return changes[field];
  }
  return fallback;
}

function freezeState(state) {
  return Object.freeze({
    state: state.state,
    consecutiveFailures: state.consecutiveFailures,
    consecutiveProbeSuccesses: state.consecutiveProbeSuccesses,
    outcomes: Object.freeze(state.outcomes.slice()),
    openedAtMs: state.openedAtMs,
    openForMs: state.openForMs,
    trips: state.trips,
    nextProbe: state.nextProbe,
    probes: Object.freeze(state.probes.slice()),
    options: freezeOptions(state.options)
  });
}

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(source, fields) {
  for (const key of Object.keys(source)) {
    if (!fields.includes(key)) {
      throw new TypeError(`unknown state field "${key}"`);
    }
  }
}

function readCircuitState(value) {
  if (!CIRCUIT_STATES.includes(value)) {
    throw new TypeError("state.state must be a breaker state");
  }
  return value;
}

function readCount(value, label) {
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function readTrips(value, circuitState) {
  if (typeof value !== "number") {
    throw new TypeError("state.trips must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("state.trips must be a non-negative safe integer");
  }
  if (circuitState === CircuitState.Closed) {
    if (value !== 0) {
      throw new RangeError("state.trips must be 0 while the breaker is closed");
    }
    return 0;
  }
  if (value < 1) {
    throw new RangeError(
      "state.trips must be a positive safe integer while the breaker is not closed"
    );
  }
  return value;
}

function readOpenedAt(value, circuitState) {
  if (circuitState === CircuitState.Closed) {
    if (value !== null) {
      throw new RangeError("state.openedAtMs must be null while the breaker is closed");
    }
    return null;
  }
  if (typeof value !== "number") {
    throw new TypeError("state.openedAtMs must be a finite number greater than or equal to 0");
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("state.openedAtMs must be a finite number greater than or equal to 0");
  }
  return value;
}

function readOpenFor(value, circuitState, options, trips) {
  if (circuitState === CircuitState.Closed) {
    if (value !== null) {
      throw new RangeError("state.openForMs must be null while the breaker is closed");
    }
    return null;
  }
  if (typeof value !== "number") {
    throw new TypeError("state.openForMs must be a finite number greater than or equal to 0");
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("state.openForMs must be a finite number greater than or equal to 0");
  }
  if (value !== openDuration(options, trips)) {
    throw new RangeError("state.openForMs does not match the open duration for state.trips");
  }
  return value;
}

function readNextProbe(value) {
  if (typeof value !== "number") {
    throw new TypeError("state.nextProbe must be a positive safe integer");
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("state.nextProbe must be a positive safe integer");
  }
  return value;
}

function readProbes(value, circuitState, nextProbe, options) {
  if (!Array.isArray(value)) {
    throw new TypeError("state.probes must be an array of positive safe integers");
  }
  if (circuitState !== CircuitState.HalfOpen && value.length > 0) {
    throw new RangeError("state.probes must be empty unless the breaker is half-open");
  }
  if (value.length > options.probeLimit) {
    throw new RangeError("state.probes must contain at most options.probeLimit ids");
  }
  const probes = [];
  let previous = 0;
  for (const id of value) {
    if (typeof id !== "number") {
      throw new TypeError("state.probes must be an array of positive safe integers");
    }
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new RangeError("state.probes must be an array of positive safe integers");
    }
    if (id <= previous) {
      throw new RangeError("state.probes must be strictly increasing");
    }
    if (id >= nextProbe) {
      throw new RangeError("each state.probes id must be less than state.nextProbe");
    }
    previous = id;
    probes.push(id);
  }
  return probes;
}

function readOutcomes(value, circuitState, options) {
  if (!Array.isArray(value)) {
    throw new TypeError("state.outcomes must be an array of outcome names");
  }
  const outcomes = [];
  for (const entry of value) {
    if (!OUTCOMES.includes(entry)) {
      throw new TypeError("state.outcomes must be an array of outcome names");
    }
    outcomes.push(entry);
  }
  if (outcomes.length > options.windowSize) {
    throw new RangeError("state.outcomes must not be longer than options.windowSize");
  }
  if (circuitState !== CircuitState.Closed && outcomes.length > 0) {
    throw new RangeError("state.outcomes must be empty unless the breaker is closed");
  }
  if (options.mode === TripMode.Consecutive && outcomes.length > 0) {
    throw new RangeError("state.outcomes must be empty in consecutive mode");
  }
  if (
    circuitState === CircuitState.Closed &&
    options.mode === TripMode.Rate &&
    rateTripped(outcomes, options)
  ) {
    throw new RangeError("state.outcomes already meets the failure rate");
  }
  return outcomes;
}

function assertCounters(circuitState, options, consecutiveFailures, consecutiveProbeSuccesses) {
  if (circuitState === CircuitState.Closed && options.mode === TripMode.Consecutive) {
    if (consecutiveFailures >= options.failureThreshold) {
      throw new RangeError("state.consecutiveFailures must be below options.failureThreshold");
    }
  } else if (consecutiveFailures !== 0) {
    throw new RangeError(
      "state.consecutiveFailures must be 0 unless the breaker is closed in consecutive mode"
    );
  }
  if (circuitState === CircuitState.HalfOpen) {
    if (consecutiveProbeSuccesses >= options.probeSuccesses) {
      throw new RangeError("state.consecutiveProbeSuccesses must be below options.probeSuccesses");
    }
  } else if (consecutiveProbeSuccesses !== 0) {
    throw new RangeError(
      "state.consecutiveProbeSuccesses must be 0 unless the breaker is half-open"
    );
  }
}
