export function openDuration(options, trips) {
  const exponent = trips - 1;
  const factor = options.backoffMultiplier ** exponent;
  if (!Number.isFinite(factor)) {
    return options.maxOpenMs;
  }
  const grown = options.openMs * factor;
  if (!Number.isFinite(grown) || grown > options.maxOpenMs) {
    return options.maxOpenMs;
  }
  return grown;
}
