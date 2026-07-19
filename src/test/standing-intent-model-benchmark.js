// Model benchmark for the standing-intent design (docs/standing-intents.md). Node-only:
//
//   node src/test/standing-intent-model-benchmark.js
//
// A model, not the engine: it reproduces the submit+resolve core's shape over the production-line
// topology so the two designs can be compared without rewriting the simulation. Numbers here are an
// upper bound on the win — the rest of the tick (belt movement, render diffing, commit) is not
// modelled and does not shrink.
//
// The submit+resolve core under two designs:
//
//   A "poll"     - today's engine: every loaded producer submits an intent every tick; the resolver
//                  dedups per destination, then walks a drain queue so a packed chain shifts as one.
//   B "standing" - a producer blocked on its destination registers a standing intent once and stops
//                  submitting. The drain walk pulls standing intents in as their destination frees,
//                  so a packed chain still shifts as one within the tick.
//
// Both produce the same movements; only the bookkeeping differs. Verified by comparing the per-tick
// move counts, which must match exactly.

const EMPTY = -1;

const LINES = 10_000;
const CHAIN = 9;              // producers per line, matching a built line's extractor->belts->machines
const WARMUP = 150;
const MEASURE = 150;

const PRODUCERS = LINES * CHAIN;
// Port p is the destination of producer p and the source of producer p+1 within a line; each line
// ends in a sink port nothing consumes unless it is drained.
const PORTS = PRODUCERS + LINES;

/**
 * Ports laid out per line: line k owns ports [k*(CHAIN+1), k*(CHAIN+1)+CHAIN].
 */
function portOf(line, index) {
    return line * (CHAIN + 1) + index;
}

function buildWorld(drainedFraction, flicker=false) {
    const source = new Int32Array(PRODUCERS);
    const dest = new Int32Array(PRODUCERS);
    for (let line = 0; line < LINES; line += 1) {
        for (let i = 0; i < CHAIN; i += 1) {
            const producer = line * CHAIN + i;
            source[producer] = portOf(line, i);
            dest[producer] = portOf(line, i + 1);
        }
    }
    const item = new Int32Array(PORTS).fill(EMPTY);
    // The head port of every line is a source that always has something to push (the extractor).
    for (let line = 0; line < LINES; line += 1) {
        item[portOf(line, 0)] = 1;
    }
    const drainedLines = Math.round(LINES * drainedFraction);
    return {source, dest, item, drainedLines, flicker};
}

/**
 * Refills every line head and drains the sinks of the flowing lines. Shared by both models so they
 * see identical world state each tick.
 */
function refillAndDrain(world, tick) {
    const {item, drainedLines, flicker} = world;
    for (let line = 0; line < LINES; line += 1) {
        item[portOf(line, 0)] = 1;
    }
    // Flicker drains every other tick, so every producer behind a sink parks and unparks constantly
    // — the worst case for a design that pays per state change instead of per tick.
    if (flicker && tick % 2 === 1) {
        return;
    }
    for (let line = 0; line < drainedLines; line += 1) {
        item[portOf(line, CHAIN)] = EMPTY;
    }
}

/**
 * Model A: today's design. Every producer holding an item submits; the resolver dedups per
 * destination and walks a drain queue to shift packed chains.
 */
function runPoll(world) {
    const {source, dest, item} = world;
    const intentSource = new Int32Array(PRODUCERS);
    const intentDest = new Int32Array(PRODUCERS);
    const intentDestEmpty = new Uint8Array(PRODUCERS);
    const winner = new Int32Array(PORTS).fill(EMPTY);
    const touchedDests = new Int32Array(PORTS);
    const draining = new Uint8Array(PORTS);
    const touchedSources = new Int32Array(PORTS);
    const queue = new Int32Array(PORTS);
    const seen = new Uint8Array(PRODUCERS);
    const resolvedRows = new Int32Array(PRODUCERS);

    let moves = 0;
    let intentTotal = 0;
    const start = performance.now();
    for (let tick = 0; tick < WARMUP + MEASURE; tick += 1) {
        const measuring = tick >= WARMUP;

        // --- submit: every producer holding an item ---
        let count = 0;
        for (let producer = 0; producer < PRODUCERS; producer += 1) {
            if (item[source[producer]] === EMPTY) {
                continue;
            }
            intentSource[count] = source[producer];
            intentDest[count] = dest[producer];
            intentDestEmpty[count] = item[dest[producer]] === EMPTY ? 1 : 0;
            count += 1;
        }
        if (measuring) {
            intentTotal += count;
        }

        // --- resolve ---
        let destCount = 0;
        let sourceCount = 0;
        let queueCount = 0;
        let resolvedCount = 0;
        for (let row = 0; row < count; row += 1) {
            const d = intentDest[row];
            if (winner[d] === EMPTY) {
                touchedDests[destCount] = d;
                destCount += 1;
                winner[d] = row;
            }
        }
        for (let index = 0; index < destCount; index += 1) {
            const row = winner[touchedDests[index]];
            if (intentDestEmpty[row] === 0) {
                continue;
            }
            resolvedRows[resolvedCount] = row;
            resolvedCount += 1;
            seen[row] = 1;
            const s = intentSource[row];
            if (draining[s] === 0) {
                draining[s] = 1;
                queue[queueCount] = s;
                queueCount += 1;
                touchedSources[sourceCount] = s;
                sourceCount += 1;
            }
        }
        for (let head = 0; head < queueCount; head += 1) {
            const row = winner[queue[head]];
            if (row === EMPTY || seen[row] === 1) {
                continue;
            }
            resolvedRows[resolvedCount] = row;
            resolvedCount += 1;
            seen[row] = 1;
            const s = intentSource[row];
            if (draining[s] === 0) {
                draining[s] = 1;
                queue[queueCount] = s;
                queueCount += 1;
                touchedSources[sourceCount] = s;
                sourceCount += 1;
            }
        }

        // --- commit, downstream first so a chain shifts as one ---
        for (let index = resolvedCount - 1; index >= 0; index -= 1) {
            const row = resolvedRows[index];
            item[intentDest[row]] = item[intentSource[row]];
            item[intentSource[row]] = EMPTY;
        }
        if (measuring) {
            moves += resolvedCount;
        }

        for (let index = 0; index < destCount; index += 1) {
            winner[touchedDests[index]] = EMPTY;
        }
        for (let index = 0; index < sourceCount; index += 1) {
            draining[touchedSources[index]] = 0;
        }
        for (let index = 0; index < resolvedCount; index += 1) {
            seen[resolvedRows[index]] = 0;
        }

        refillAndDrain(world, tick);
    }
    return {ms: performance.now() - start, moves, intents: intentTotal};
}

/**
 * Model B: standing intents. A producer whose destination is occupied parks itself on that
 * destination and stops submitting; the drain walk pulls it back in the moment its destination
 * frees, so chains still shift as one. Parked producers cost nothing per tick.
 */
function runStanding(world) {
    const {source, dest, item} = world;

    // Waiter lists per port. Every producer waits on exactly one destination, so a single linked
    // list threaded through the producers themselves holds them with no per-port allocation.
    const waiterHead = new Int32Array(PORTS).fill(EMPTY);
    const waiterNext = new Int32Array(PRODUCERS).fill(EMPTY);
    const parked = new Uint8Array(PRODUCERS);

    // Producers that may move this tick: everything not parked. Kept as a dense list so a tick walks
    // only the live ones.
    let active = new Int32Array(PRODUCERS);
    let activeCount = PRODUCERS;
    for (let producer = 0; producer < PRODUCERS; producer += 1) {
        active[producer] = producer;
    }
    let nextActive = new Int32Array(PRODUCERS);

    const queue = new Int32Array(PORTS);
    const resolved = new Int32Array(PRODUCERS);

    /**
     * Parks `producer` on the destination it is blocked by.
     */
    function park(producer, port) {
        parked[producer] = 1;
        waiterNext[producer] = waiterHead[port];
        waiterHead[port] = producer;
    }

    let moves = 0;
    let intentTotal = 0;
    const start = performance.now();
    for (let tick = 0; tick < WARMUP + MEASURE; tick += 1) {
        const measuring = tick >= WARMUP;

        // --- pass over the active producers only ---
        let queueCount = 0;
        let resolvedCount = 0;
        let nextCount = 0;
        let submitted = 0;
        for (let index = 0; index < activeCount; index += 1) {
            const producer = active[index];
            if (parked[producer] === 1) {
                continue;
            }
            const s = source[producer];
            if (item[s] === EMPTY) {
                // Nothing to push: stays active, it is waiting on its own source rather than a jam.
                nextActive[nextCount] = producer;
                nextCount += 1;
                continue;
            }
            submitted += 1;
            const d = dest[producer];
            if (item[d] === EMPTY) {
                resolved[resolvedCount] = producer;
                resolvedCount += 1;
                queue[queueCount] = s;
                queueCount += 1;
                nextActive[nextCount] = producer;
                nextCount += 1;
            } else {
                // Blocked: park on the destination and stop paying for it every tick.
                park(producer, d);
            }
        }
        if (measuring) {
            intentTotal += submitted;
        }

        // --- drain walk: a freed port wakes whatever was parked on it, so the chain shifts as one ---
        for (let head = 0; head < queueCount; head += 1) {
            const port = queue[head];
            let waiter = waiterHead[port];
            if (waiter === EMPTY) {
                continue;
            }
            waiterHead[port] = EMPTY;
            while (waiter !== EMPTY) {
                const next = waiterNext[waiter];
                waiterNext[waiter] = EMPTY;
                parked[waiter] = 0;
                const s = source[waiter];
                if (item[s] === EMPTY) {
                    nextActive[nextCount] = waiter;
                    nextCount += 1;
                } else {
                    resolved[resolvedCount] = waiter;
                    resolvedCount += 1;
                    queue[queueCount] = s;
                    queueCount += 1;
                    nextActive[nextCount] = waiter;
                    nextCount += 1;
                }
                waiter = next;
            }
        }

        // --- commit, downstream first ---
        for (let index = resolvedCount - 1; index >= 0; index -= 1) {
            const producer = resolved[index];
            item[dest[producer]] = item[source[producer]];
            item[source[producer]] = EMPTY;
        }
        if (measuring) {
            moves += resolvedCount;
        }

        const swap = active;
        active = nextActive;
        nextActive = swap;
        activeCount = nextCount;

        refillAndDrain(world, tick);

        // A drained sink frees a port the engine did not route through the queue, so wake its waiters
        // the way the real engine would from setPortItem.
        const drainedThisTick = !world.flicker || tick % 2 === 0;
        for (let line = 0; drainedThisTick && line < world.drainedLines; line += 1) {
            const port = portOf(line, CHAIN);
            let waiter = waiterHead[port];
            waiterHead[port] = EMPTY;
            while (waiter !== EMPTY) {
                const next = waiterNext[waiter];
                waiterNext[waiter] = EMPTY;
                parked[waiter] = 0;
                active[activeCount] = waiter;
                activeCount += 1;
                waiter = next;
            }
        }
    }
    return {ms: performance.now() - start, moves, intents: intentTotal};
}

console.log(`${LINES.toLocaleString()} lines x ${CHAIN} producers = ${PRODUCERS.toLocaleString()} producers`);
console.log(`${MEASURE} measured ticks after ${WARMUP} warmup, best of 3\n`);
console.log("scenario           poll ms   standing ms   speedup   poll intents   standing intents   moves match");
const scenarios = [
    ["steady 100% drained", 1, false],
    ["steady 75% drained", 0.75, false],
    ["steady 50% drained", 0.5, false],
    ["steady 25% drained", 0.25, false],
    ["steady 0% drained", 0, false],
    ["flicker 100% drained", 1, true],
    ["flicker 50% drained", 0.5, true],
];
for (const [label, fraction, flicker] of scenarios) {
    let poll = null;
    let standing = null;
    for (let repeat = 0; repeat < 3; repeat += 1) {
        const a = runPoll(buildWorld(fraction, flicker));
        const b = runStanding(buildWorld(fraction, flicker));
        if (poll === null || a.ms < poll.ms) {
            poll = a;
        }
        if (standing === null || b.ms < standing.ms) {
            standing = b;
        }
    }
    const speedup = poll.ms / standing.ms;
    console.log(
        `${label.padEnd(20)} ${(poll.ms / MEASURE).toFixed(3).padStart(7)} `
        + `${(standing.ms / MEASURE).toFixed(3).padStart(13)} ${speedup.toFixed(2).padStart(9)}x `
        + `${Math.round(poll.intents / MEASURE).toLocaleString().padStart(14)} `
        + `${Math.round(standing.intents / MEASURE).toLocaleString().padStart(18)} `
        + `${String(poll.moves === standing.moves).padStart(13)}`
    );
}
