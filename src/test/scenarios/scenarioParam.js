// Selects a scenario: ?scenario=lines&lines=200
export const SCENARIO_PARAM = "scenario";

/**
 * Parses a positive integer query param, falling back when absent or unparsable.
 * @param {string|null} raw
 * @param {number} fallback
 * @returns {number}
 */
export function positiveIntParam(raw, fallback) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

/**
 * Parses a non-negative integer query param, falling back when absent or unparsable.
 * @param {string|null} raw
 * @param {number} fallback
 * @returns {number}
 */
export function nonNegativeIntParam(raw, fallback) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return fallback;
}
