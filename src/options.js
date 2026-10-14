import {
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_FAILURE_RATE,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MAX_OPEN_MS,
  DEFAULT_MINIMUM_CALLS,
  DEFAULT_OPEN_MS,
  DEFAULT_PROBE_LIMIT,
  DEFAULT_PROBE_SUCCESSES,
  DEFAULT_WINDOW_SIZE,
  OPTION_FIELDS,
  TRIP_MODES,
  TripMode
} from "./constants.js";

export function resolveOptions(options) {
  const source = optionalOptions(options);
  rejectUnknown(source, OPTION_FIELDS, "option");
  const mode = readMode(source);
  const failureThreshold = readPositiveInteger(
    source,
    "failureThreshold",
    DEFAULT_FAILURE_THRESHOLD
  );
  const failureRate = readFailureRate(source);
  const windowSize = readPositiveInteger(source, "windowSize", DEFAULT_WINDOW_SIZE);
  const minimumCalls = readMinimumCalls(source, windowSize);
  const openMs = readOpenMs(source);
  const probeLimit = readPositiveInteger(source, "probeLimit", DEFAULT_PROBE_LIMIT);
  const probeSuccesses = readPositiveInteger(source, "probeSuccesses", DEFAULT_PROBE_SUCCESSES);
  const backoffMultiplier = readBackoff(source);
  const maxOpenMs = readMaxOpenMs(source, openMs);
  return freezeOptions({
    mode,
    failureThreshold,
    failureRate,
    windowSize,
    minimumCalls,
    openMs,
    probeLimit,
    probeSuccesses,
    backoffMultiplier,
    maxOpenMs
  });
}

export function readStoredOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("state.options must be an object");
  }
  rejectUnknown(options, OPTION_FIELDS, "option");
  for (const field of OPTION_FIELDS) {
    if (!Object.hasOwn(options, field)) {
      throw new TypeError(`state.options.${field} is required`);
    }
  }
  return resolveOptions(options);
}

export function freezeOptions(options) {
  return Object.freeze({
    mode: options.mode,
    failureThreshold: options.failureThreshold,
    failureRate: options.failureRate,
    windowSize: options.windowSize,
    minimumCalls: options.minimumCalls,
    openMs: options.openMs,
    probeLimit: options.probeLimit,
    probeSuccesses: options.probeSuccesses,
    backoffMultiplier: options.backoffMultiplier,
    maxOpenMs: options.maxOpenMs
  });
}

function optionalOptions(options) {
  if (options === undefined) {
    return {};
  }
  if (!isRecord(options)) {
    throw new TypeError("options must be an object");
  }
  return options;
}

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(source, fields, label) {
  for (const key of Object.keys(source)) {
    if (!fields.includes(key)) {
      throw new TypeError(`unknown ${label} "${key}"`);
    }
  }
}

function readMode(source) {
  if (!Object.hasOwn(source, "mode")) {
    return TripMode.Consecutive;
  }
  if (!TRIP_MODES.includes(source.mode)) {
    throw new TypeError("options.mode must be a trip mode");
  }
  return source.mode;
}

function readPositiveInteger(source, field, fallback) {
  if (!Object.hasOwn(source, field)) {
    return fallback;
  }
  const value = source[field];
  if (typeof value !== "number") {
    throw new TypeError(`options.${field} must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`options.${field} must be a positive safe integer`);
  }
  return value;
}

function readMinimumCalls(source, windowSize) {
  const minimumCalls = readPositiveInteger(source, "minimumCalls", DEFAULT_MINIMUM_CALLS);
  if (minimumCalls > windowSize) {
    throw new RangeError("options.minimumCalls must be less than or equal to options.windowSize");
  }
  return minimumCalls;
}

function readFailureRate(source) {
  if (!Object.hasOwn(source, "failureRate")) {
    return DEFAULT_FAILURE_RATE;
  }
  const value = source.failureRate;
  if (typeof value !== "number") {
    throw new TypeError("options.failureRate must be a finite number greater than 0 and at most 1");
  }
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(
      "options.failureRate must be a finite number greater than 0 and at most 1"
    );
  }
  return value;
}

function readOpenMs(source) {
  if (!Object.hasOwn(source, "openMs")) {
    return DEFAULT_OPEN_MS;
  }
  const value = source.openMs;
  if (typeof value !== "number") {
    throw new TypeError("options.openMs must be a finite number greater than or equal to 0");
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("options.openMs must be a finite number greater than or equal to 0");
  }
  return value;
}

function readBackoff(source) {
  if (!Object.hasOwn(source, "backoffMultiplier")) {
    return DEFAULT_BACKOFF_MULTIPLIER;
  }
  const value = source.backoffMultiplier;
  if (typeof value !== "number") {
    throw new TypeError(
      "options.backoffMultiplier must be a finite number greater than or equal to 1"
    );
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(
      "options.backoffMultiplier must be a finite number greater than or equal to 1"
    );
  }
  return value;
}

function readMaxOpenMs(source, openMs) {
  if (!Object.hasOwn(source, "maxOpenMs")) {
    if (openMs > DEFAULT_MAX_OPEN_MS) {
      return openMs;
    }
    return DEFAULT_MAX_OPEN_MS;
  }
  const value = source.maxOpenMs;
  if (typeof value !== "number") {
    throw new TypeError(
      "options.maxOpenMs must be a finite number greater than or equal to options.openMs"
    );
  }
  if (!Number.isFinite(value) || value < openMs) {
    throw new RangeError(
      "options.maxOpenMs must be a finite number greater than or equal to options.openMs"
    );
  }
  return value;
}
