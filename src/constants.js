export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_FAILURE_RATE = 0.5;
export const DEFAULT_WINDOW_SIZE = 10;
export const DEFAULT_MINIMUM_CALLS = 10;
export const DEFAULT_OPEN_MS = 30000;
export const DEFAULT_PROBE_LIMIT = 1;
export const DEFAULT_PROBE_SUCCESSES = 1;
export const DEFAULT_BACKOFF_MULTIPLIER = 1;
export const DEFAULT_MAX_OPEN_MS = 300000;

export const CircuitState = Object.freeze({
  Closed: "closed",
  Open: "open",
  HalfOpen: "half-open"
});

export const CIRCUIT_STATES = Object.freeze([
  CircuitState.Closed,
  CircuitState.Open,
  CircuitState.HalfOpen
]);

export const TripMode = Object.freeze({
  Consecutive: "consecutive",
  Rate: "rate"
});

export const TRIP_MODES = Object.freeze([TripMode.Consecutive, TripMode.Rate]);

export const Outcome = Object.freeze({
  Success: "success",
  Failure: "failure"
});

export const OUTCOMES = Object.freeze([Outcome.Success, Outcome.Failure]);

export const DecisionReason = Object.freeze({
  Allow: "allow",
  RejectOpen: "reject-open",
  AllowProbe: "allow-probe",
  RejectProbeLimit: "reject-probe-limit"
});

export const DECISION_REASONS = Object.freeze([
  DecisionReason.Allow,
  DecisionReason.RejectOpen,
  DecisionReason.AllowProbe,
  DecisionReason.RejectProbeLimit
]);

export const OPTION_FIELDS = Object.freeze([
  "mode",
  "failureThreshold",
  "failureRate",
  "windowSize",
  "minimumCalls",
  "openMs",
  "probeLimit",
  "probeSuccesses",
  "backoffMultiplier",
  "maxOpenMs"
]);

export const STATE_FIELDS = Object.freeze([
  "state",
  "consecutiveFailures",
  "consecutiveProbeSuccesses",
  "outcomes",
  "openedAtMs",
  "openForMs",
  "trips",
  "nextProbe",
  "probes",
  "options"
]);

export const DECISION_FIELDS = Object.freeze(["allowed", "reason", "probe", "state"]);
