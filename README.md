# circuit-trip

Decide whether a call may run. The decision is a pure function of a breaker object, a timestamp, and the outcome reported afterward.

`closed` counts failures and lets calls through. `open` refuses calls until a quiet interval has passed. `half-open` lets a limited number of probe calls through. Enough probe successes in a row return the breaker to `closed`. One failed probe returns it to `open` and starts the quiet interval again.

The caller owns the clock and the attempt. This module does not call the protected function, start a timer, or read the wall clock. Every function returns a new object, so the breaker can be stored with `JSON.stringify` and restored with `JSON.parse`.

## Install

The package is an ES module. It needs Node.js 20 or newer. It has no runtime dependencies. The package name is `@aneron/circuit-trip`. It is not published to the npm registry.

Clone this repository and run the tests:

```bash
git clone https://github.com/ANERON-GAMES/circuit-trip.git
cd circuit-trip
npm install
npm test
```

`npm test` runs `node --test`. `npm run lint` runs ESLint. `npm run format:check` runs Prettier.

Install it as a dependency from the git repository:

```bash
npm install github:ANERON-GAMES/circuit-trip
```

```js
import { canPass, createBreaker, recordFailure, recordSuccess } from "@aneron/circuit-trip";
```

Code in this repository imports the same entry point with `./src/index.js`.

## Usage

Two failures inside a threshold of two open the breaker for 1000 ms. A probe that fails after that interval opens it again, this time for 2000 ms, because the backoff multiplier is 2. Two probe successes then close it.

```js
import { canPass, createBreaker, recordFailure, recordSuccess } from "@aneron/circuit-trip";

let breaker = createBreaker({
  failureThreshold: 2,
  openMs: 1000,
  probeSuccesses: 2,
  backoffMultiplier: 2,
  maxOpenMs: 8000
});

const first = canPass(breaker, 0);
breaker = recordFailure(first.state, 0, first.probe);

const second = canPass(breaker, 10);
breaker = recordFailure(second.state, 10, second.probe);

const refused = canPass(breaker, 1009);
const probe = canPass(breaker, 1010);
breaker = recordFailure(probe.state, 1010, probe.probe);

const next = canPass(breaker, 3010);
breaker = recordSuccess(next.state, 3010, next.probe);
const again = canPass(breaker, 3010);
breaker = recordSuccess(again.state, 3010, again.probe);
```

`first.allowed` is `true`, `first.reason` is `"allow"`, and `first.probe` is `null`. After that record the breaker is still `closed`, with `consecutiveFailures` of `1`.

`second` is allowed as well. The record at time `10` opens the breaker: `openedAtMs` is `10`, `openForMs` is `1000`, and `trips` is `1`.

`refused.allowed` is `false` and `refused.reason` is `"reject-open"`. Time `1009` is one millisecond short of the open interval.

`probe.allowed` is `true`, `probe.reason` is `"allow-probe"`, and `probe.probe` is `1`. The record of that probe fails, so the breaker opens again at time `1010` with `openForMs` of `2000` and `trips` of `2`.

`next` admits probe `2`. Its success leaves the breaker `half-open` with `consecutiveProbeSuccesses` of `1`. `again` admits probe `3`. Its success closes the breaker and clears the counters. `nextProbe` is `4`, so those probe ids are not reused.

Keep the object returned by each call. A second `canPass` on the same open snapshot admits the same probe again, because the function only reads the object it was given.

## API reference

All functions are pure. They do not read the clock, the network, or the filesystem. They do not modify the objects or arrays you pass in. Returned breakers, decisions, option objects, `outcomes`, and `probes` are frozen.

### Constants

| Export                            | Value                  | Meaning                                                             |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `DEFAULT_FAILURE_THRESHOLD`       | `5`                    | Consecutive failures that open the breaker.                         |
| `DEFAULT_FAILURE_RATE`            | `0.5`                  | Failure share that opens the breaker in rate mode.                  |
| `DEFAULT_WINDOW_SIZE`             | `10`                   | Maximum number of outcomes kept in the rate window.                 |
| `DEFAULT_MINIMUM_CALLS`           | `10`                   | Outcomes required before a rate can open the breaker.               |
| `DEFAULT_OPEN_MS`                 | `30000`                | Quiet interval after a trip, in milliseconds.                       |
| `DEFAULT_PROBE_LIMIT`             | `1`                    | Probe calls in flight during `half-open`.                           |
| `DEFAULT_PROBE_SUCCESSES`         | `1`                    | Consecutive probe successes that close the breaker.                 |
| `DEFAULT_BACKOFF_MULTIPLIER`      | `1`                    | Growth of the quiet interval on repeated trips. `1` keeps `openMs`. |
| `DEFAULT_MAX_OPEN_MS`             | `300000`               | Cap on the quiet interval.                                          |
| `CircuitState.Closed`             | `"closed"`             | Calls are allowed. Failures are counted.                            |
| `CircuitState.Open`               | `"open"`               | Calls are refused until the quiet interval ends.                    |
| `CircuitState.HalfOpen`           | `"half-open"`          | A limited number of probes may run.                                 |
| `TripMode.Consecutive`            | `"consecutive"`        | Open after a streak of failures.                                    |
| `TripMode.Rate`                   | `"rate"`               | Open when a rolling count window is too full of failures.           |
| `Outcome.Success`                 | `"success"`            | A successful sample in `outcomes`.                                  |
| `Outcome.Failure`                 | `"failure"`            | A failed sample in `outcomes`.                                      |
| `DecisionReason.Allow`            | `"allow"`              | The closed breaker allowed the call.                                |
| `DecisionReason.RejectOpen`       | `"reject-open"`        | The open interval has not elapsed.                                  |
| `DecisionReason.AllowProbe`       | `"allow-probe"`        | A half-open probe was admitted.                                     |
| `DecisionReason.RejectProbeLimit` | `"reject-probe-limit"` | `probeLimit` probes are already in flight.                          |

`CIRCUIT_STATES`, `TRIP_MODES`, `OUTCOMES`, and `DECISION_REASONS` are frozen arrays of those string values, in the order listed above.

`STATE_FIELDS`, `OPTION_FIELDS`, and `DECISION_FIELDS` are frozen arrays of the keys on a breaker, its `options`, and a decision. Each returned object uses that key order.

`CircuitState`, `TripMode`, `Outcome`, `DecisionReason`, and the arrays above are frozen.

### `createBreaker(options)`

Return the initial breaker. `options` may be omitted or `{}`. `undefined` is omitted. Any other non-object throws `TypeError` with message `options must be an object`.

| Option              | Default                | Rule                                                                                 |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `mode`              | `TripMode.Consecutive` | `TripMode.Consecutive` or `TripMode.Rate`.                                           |
| `failureThreshold`  | `5`                    | Positive safe integer. Used in consecutive mode.                                     |
| `failureRate`       | `0.5`                  | Finite number greater than `0` and at most `1`. Used in rate mode.                   |
| `windowSize`        | `10`                   | Positive safe integer. Capacity of the rate window.                                  |
| `minimumCalls`      | `10`                   | Positive safe integer, at most `windowSize`. Rate mode waits for this many outcomes. |
| `openMs`            | `30000`                | Finite number greater than or equal to `0`. Quiet interval of the first trip.        |
| `probeLimit`        | `1`                    | Positive safe integer. Concurrent probes while half-open.                            |
| `probeSuccesses`    | `1`                    | Positive safe integer. Consecutive probe successes that close the breaker.           |
| `backoffMultiplier` | `1`                    | Finite number greater than or equal to `1`.                                          |
| `maxOpenMs`         | `300000`               | Finite number greater than or equal to `openMs`.                                     |

Every option is validated even when the selected mode does not read it. An unknown key throws `TypeError` with message `unknown option "<key>"`. A value of the wrong type throws `TypeError`. A number outside the range throws `RangeError`. The message names the option and the constraint.

When `minimumCalls` is omitted it stays `10`. A `windowSize` below `10` has to set `minimumCalls` as well, or creation throws `RangeError` with message `options.minimumCalls must be less than or equal to options.windowSize`.

When `maxOpenMs` is omitted and `openMs` is greater than `DEFAULT_MAX_OPEN_MS`, the stored cap is `openMs`.

The returned `options` object is a copy. Later writes to the object passed in do not change the breaker.

The initial breaker is `closed`. `consecutiveFailures`, `consecutiveProbeSuccesses`, and `trips` are `0`. `outcomes` and `probes` are empty. `openedAtMs` and `openForMs` are `null`. `nextProbe` is `1`.

### `canPass(breaker, nowMs)`

Decide whether a call may run at `nowMs`.

| Argument  | Type   | Role                                                                                |
| --------- | ------ | ----------------------------------------------------------------------------------- |
| `breaker` | object | A breaker from `createBreaker`, from a previous return value, or from `JSON.parse`. |
| `nowMs`   | number | Caller clock, finite and greater than or equal to `0`.                              |

The return value is a frozen decision:

| Field     | Type             | Meaning                                                                                        |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `allowed` | boolean          | `true` when the caller may run the attempt.                                                    |
| `reason`  | string           | One of `DECISION_REASONS`.                                                                     |
| `probe`   | number or `null` | Token passed to `recordSuccess` or `recordFailure`. `null` when the call is closed or refused. |
| `state`   | object           | Next breaker.                                                                                  |

`nowMs` that is not a number throws `TypeError` with message `nowMs must be a number`. A non-finite or negative number throws `RangeError` with message `nowMs must be a finite number greater than or equal to 0`.

The checks run in this order.

1. A breaker that is not a plain object, that has an unknown field, or that breaks an invariant throws `TypeError` or `RangeError`. See [Errors](#errors).
2. `closed`: `allowed` is `true`, `reason` is `"allow"`, and `probe` is `null`. Counters stay as they were.
3. `open`, while `nowMs - openedAtMs < openForMs`: `allowed` is `false`, `reason` is `"reject-open"`, and `probe` is `null`. A `nowMs` earlier than `openedAtMs` takes this path.
4. `open`, once `nowMs - openedAtMs >= openForMs`: the breaker becomes `half-open`, one probe is admitted, `allowed` is `true`, and `reason` is `"allow-probe"`. `probe` is the admitted id.
5. `half-open`, while `probes.length < probeLimit`: another probe is admitted with reason `"allow-probe"`. The open interval is not read again.
6. `half-open`, while `probes.length >= probeLimit`: `allowed` is `false` and `reason` is `"reject-probe-limit"`.

An `openMs` of `0` makes step 4 succeed on the trip timestamp itself.

Admitted probe ids start at `1` and increase by one. `nextProbe` is the next id. It is not reset when the breaker closes.

### `recordSuccess(breaker, nowMs, probe)`

### `recordFailure(breaker, nowMs, probe)`

Report the outcome of an allowed call. Both return the next breaker. `nowMs` uses the same rule as `canPass`. The time is stored only when the outcome opens the breaker. On every other path it is checked and then dropped.

| Argument  | Type             | Role                                                       |
| --------- | ---------------- | ---------------------------------------------------------- |
| `breaker` | object           | Breaker that allowed the call.                             |
| `nowMs`   | number           | Time of the outcome.                                       |
| `probe`   | number or `null` | `decision.probe` from the `canPass` that allowed the call. |

`probe` must be `null` or a positive safe integer. Any other value throws `TypeError` or `RangeError` with message `probe must be null or a positive safe integer`.

Recording while the breaker is `open` throws `RangeError` with message `cannot record an outcome while the breaker is open`.

Recording a number while the breaker is `closed` throws `RangeError` with message `probe must be null while the breaker is closed`.

Recording an id that is not in `probes` throws `RangeError` with message `probe does not match an admitted probe`. Each admitted id can be recorded once.

#### Closed, consecutive mode

`recordSuccess` sets `consecutiveFailures` to `0`.

`recordFailure` adds one to `consecutiveFailures`. When the count reaches `failureThreshold` the breaker trips. `failureRate`, `windowSize`, and `minimumCalls` are ignored. `outcomes` stays empty.

#### Closed, rate mode

The outcome `"success"` or `"failure"` is appended to `outcomes`. Entries past `windowSize` are dropped from the front.

The breaker trips when `outcomes.length >= minimumCalls` and `failureCount / outcomes.length >= failureRate`. `failureThreshold` is ignored, and `consecutiveFailures` stays `0`.

A success can trip. That happens when the success is the sample that first makes the window long enough, and the failures already inside it meet `failureRate`. Adding a success never raises the share of a window that was already long enough to be judged.

#### Half-open

`recordSuccess` removes `probe` from `probes` and adds one to `consecutiveProbeSuccesses`. When the streak reaches `probeSuccesses` the breaker closes.

`recordFailure` trips. The open interval restarts at this `nowMs`. Every other in-flight probe is dropped. A later record of those ids throws, because the breaker is `open`.

Closing sets `consecutiveFailures`, `consecutiveProbeSuccesses`, `trips`, and the in-flight probes to empty or zero, sets `openedAtMs` and `openForMs` to `null`, and clears `outcomes`. `options` and `nextProbe` stay. The next closed failure starts a fresh streak or a fresh window, and the next trip uses `openMs` again.

### Trip

A trip sets `state` to `"open"`, `openedAtMs` to the outcome time, and `openForMs` to the quiet interval. It clears `consecutiveFailures`, `consecutiveProbeSuccesses`, `outcomes`, and `probes`. `trips` becomes the previous count plus one. The first trip after a close is trip `1`.

The quiet interval is `min(openMs * backoffMultiplier ** (trips - 1), maxOpenMs)`. A power that overflows the finite range uses `maxOpenMs`. An `openMs` of `0` stays `0`, because the grown value is still `0`.

`state.trips` and `state.nextProbe` throw `RangeError` if the next value would pass `Number.MAX_SAFE_INTEGER`. The messages are `state.trips cannot increase past the safe integer range` and `state.nextProbe cannot increase past the safe integer range`.

### Breaker

| Field                       | Type             | Meaning                                                                                                                                 |
| --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                     | string           | `closed`, `open`, or `half-open`.                                                                                                       |
| `consecutiveFailures`       | number           | Failure streak. It moves only while `closed` in consecutive mode.                                                                       |
| `consecutiveProbeSuccesses` | number           | Probe success streak. It moves only while `half-open`.                                                                                  |
| `outcomes`                  | string[]         | Rate window while `closed`. Each entry is `"success"` or `"failure"`. Empty in consecutive mode, and empty while `open` or `half-open`. |
| `openedAtMs`                | number or `null` | Trip time while `open` or `half-open`. `null` while `closed`.                                                                           |
| `openForMs`                 | number or `null` | Quiet interval of the current trip. `null` while `closed`.                                                                              |
| `trips`                     | number           | Trips since the last close. `0` while `closed`.                                                                                         |
| `nextProbe`                 | number           | Next probe id. Starts at `1`.                                                                                                           |
| `probes`                    | number[]         | In-flight probe ids while `half-open`, strictly increasing. Empty in the other states.                                                  |
| `options`                   | object           | Policy stored by `createBreaker`.                                                                                                       |

`openForMs` is the duration computed from `trips` and `options`. A snapshot whose `openForMs` differs is rejected.

A closed consecutive breaker whose `consecutiveFailures` is already at `failureThreshold` is rejected. A closed rate window that already meets `failureRate` is rejected. `consecutiveProbeSuccesses` while half-open is below `probeSuccesses`.

### Errors

Invalid input throws before the breaker changes. `TypeError` covers a value of the wrong type, an unknown field, and a missing field. `RangeError` covers a number outside its range and a snapshot that breaks an invariant.

Breaker shape:

| Condition                       | Error       | Message                               |
| ------------------------------- | ----------- | ------------------------------------- |
| `breaker` is not a plain object | `TypeError` | `state must be an object`             |
| Unknown key                     | `TypeError` | `unknown state field "<key>"`         |
| Missing key                     | `TypeError` | `state.<field> is required`           |
| `state` is not a circuit state  | `TypeError` | `state.state must be a breaker state` |
| `options` is not a plain object | `TypeError` | `state.options must be an object`     |
| Missing option on a snapshot    | `TypeError` | `state.options.<field> is required`   |
| Unknown option on a snapshot    | `TypeError` | `unknown option "<key>"`              |

Count fields (`consecutiveFailures`, `consecutiveProbeSuccesses`, `trips`) use `state.<field> must be a non-negative safe integer`. `nextProbe` uses `state.nextProbe must be a positive safe integer`. `outcomes` uses `state.outcomes must be an array of outcome names`. `probes` uses `state.probes must be an array of positive safe integers`.

Invariant messages:

| Message                                                                                |
| -------------------------------------------------------------------------------------- |
| `state.trips must be 0 while the breaker is closed`                                    |
| `state.trips must be a positive safe integer while the breaker is not closed`          |
| `state.openedAtMs must be null while the breaker is closed`                            |
| `state.openedAtMs must be a finite number greater than or equal to 0`                  |
| `state.openForMs must be null while the breaker is closed`                             |
| `state.openForMs must be a finite number greater than or equal to 0`                   |
| `state.openForMs does not match the open duration for state.trips`                     |
| `state.probes must be empty unless the breaker is half-open`                           |
| `state.probes must contain at most options.probeLimit ids`                             |
| `state.probes must be strictly increasing`                                             |
| `each state.probes id must be less than state.nextProbe`                               |
| `state.consecutiveProbeSuccesses must be 0 unless the breaker is half-open`            |
| `state.consecutiveProbeSuccesses must be below options.probeSuccesses`                 |
| `state.consecutiveFailures must be below options.failureThreshold`                     |
| `state.consecutiveFailures must be 0 unless the breaker is closed in consecutive mode` |
| `state.outcomes must be empty in consecutive mode`                                     |
| `state.outcomes must be empty unless the breaker is closed`                            |
| `state.outcomes must not be longer than options.windowSize`                            |
| `state.outcomes already meets the failure rate`                                        |

Option messages are the constraint sentences in [`createBreaker`](#createbreakeroptions). A wrong type and an out-of-range number share the same message and differ by `TypeError` or `RangeError`.

## Design notes

The caller threads one breaker object from call to call. `canPass` and the record functions read that object and return a different one. Two calls given the same snapshot do not see each other's result. Persist `decision.state` or the breaker returned by a record, including after a refusal.

A closed decision uses a `null` probe because closed calls are not paired. Every allowed closed outcome is counted. A half-open decision uses a numeric probe so each in-flight attempt is distinct. Record that id once. When a failure or a closing success leaves `half-open`, the other in-flight ids no longer match, and recording them throws. That keeps an abandoned probe from opening or closing the breaker a second time.

The open interval is measured from the outcome that tripped, with `nowMs - openedAtMs >= openForMs`. The comparison is ordinary floating-point subtraction. Pass a monotonic millisecond clock whose values leave room for `openForMs` in the difference. Once the breaker is `half-open`, later `canPass` calls admit probes until `probeLimit` and do not read the interval again. There is no probe deadline in the state. When a probe runs too long, call `recordFailure` with its id.

Policy is fixed on the breaker at creation. Consecutive mode and rate mode are two choices of `mode`, and the unused thresholds remain on `options` so a snapshot still validates. The rate window is a count of the newest outcomes, up to `windowSize`. It becomes eligible at `minimumCalls`, which may be lower than `windowSize`. It is a count window: timestamps are not stored in `outcomes`.

Closing is the reset. Streaks, the rate window, the trip count, and the quiet interval go back to their closed values. The backoff sequence starts at `openMs` on the next trip. Probe ids keep increasing for the life of the snapshot.

`JSON.stringify` on a returned breaker produces a plain snapshot. `JSON.parse` of that text is accepted by the next call. The following return value is frozen again. A snapshot that already expresses a trip, a full probe streak, or an open interval other than the one `trips` implies is rejected, so a damaged write fails before it is treated as live.

This module leaves the attempt, the clock, persistence, and retries to the caller. It does not wrap a function, schedule the quiet interval, open a socket, or choose a fallback. Closed calls have no concurrency cap. `probeLimit` applies to half-open probes only.

## License

Released under the MIT License. The full text is in [LICENSE](LICENSE).
