import { Outcome } from "./constants.js";

export function countFailures(outcomes) {
  let failures = 0;
  for (const outcome of outcomes) {
    if (outcome === Outcome.Failure) {
      failures += 1;
    }
  }
  return failures;
}

export function rateTripped(outcomes, options) {
  if (outcomes.length < options.minimumCalls) {
    return false;
  }
  return countFailures(outcomes) / outcomes.length >= options.failureRate;
}

export function pushOutcome(outcomes, outcome, windowSize) {
  const next = outcomes.slice();
  next.push(outcome);
  if (next.length > windowSize) {
    return next.slice(next.length - windowSize);
  }
  return next;
}
