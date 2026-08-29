import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import * as UiScale from "@/client/hud/UiScale.js";

// WCAG 2.5.8 Target Size (Minimum), level AA, and 2.5.5 (Enhanced), level AAA, in CSS pixels.
const TARGET_SIZE_AA = 24;
const TARGET_SIZE_AAA = 44;

/**
 * Runs `check` with the UI at `scale`, restoring the normal scale afterwards.
 * @param {number} scale
 * @param {function(): void} check
 * @returns {void}
 */
function atScale(scale, check) {
    UiScale.applyUiScale(scale);
    try {
        check();
    } finally {
        UiScale.applyUiScale(UiScale.UI_SCALE_NORMAL);
    }
}

/**
 * @param {number} required
 * @returns {string[]} one line per target smaller than `required`
 */
function undersized(required) {
    const failures = [];
    for (const target of UiScale.tapTargets()) {
        if (target.width < required || target.height < required) {
            failures.push(`${target.where} is ${target.width}x${target.height}, needs ${required}x${required}`);
        }
    }
    return failures;
}

test("every tap target meets WCAG AA at the normal scale", () => {
    atScale(UiScale.UI_SCALE_NORMAL, () => {
        assert.deepEqual(undersized(TARGET_SIZE_AA), []);
    });
});

test("every tap target meets WCAG AAA at the big scale", () => {
    atScale(UiScale.UI_SCALE_BIG, () => {
        assert.deepEqual(undersized(TARGET_SIZE_AAA), []);
    });
});

test("the big scale is no larger than the smallest target requires", () => {
    // Whatever forces UI_SCALE_BIG up is the target worth growing at the normal scale first.
    atScale(UiScale.UI_SCALE_NORMAL, () => {
        const smallest = Math.min(...UiScale.tapTargets().map(target => Math.min(target.width, target.height)));
        const needed = TARGET_SIZE_AAA / smallest;
        assert.ok(
            UiScale.UI_SCALE_BIG < needed + 0.1,
            `UI_SCALE_BIG is ${UiScale.UI_SCALE_BIG} but only ${needed.toFixed(2)} is needed`,
        );
    });
});

test("a scale change notifies its listeners", () => {
    let scales = [];
    const stop = UiScale.onUiScaleChange(() => scales.push(UiScale.uiScale()));
    atScale(UiScale.UI_SCALE_BIG, () => {});
    stop();
    // The change into the big scale, and the restore back out of it.
    assert.deepEqual(scales, [UiScale.UI_SCALE_BIG, UiScale.UI_SCALE_NORMAL]);

    scales = [];
    atScale(UiScale.UI_SCALE_BIG, () => {});
    assert.deepEqual(scales, [], "unsubscribing must stop the notifications");
});

test("the slider's range spans normal to big", () => {
    assert.equal(UiScale.UI_SCALE_MIN, UiScale.UI_SCALE_NORMAL);
    assert.equal(UiScale.UI_SCALE_MAX, UiScale.UI_SCALE_BIG);
    // A step the range divides into, so the slider can reach both ends exactly.
    const steps = (UiScale.UI_SCALE_MAX - UiScale.UI_SCALE_MIN) / UiScale.UI_SCALE_STEP;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `range is ${steps} steps`);
});

test("applying a scale and returning restores every size", () => {
    const before = UiScale.tapTargets();
    atScale(UiScale.UI_SCALE_BIG, () => {});
    assert.deepEqual(UiScale.tapTargets(), before);
});

// A module-scope `const X = <scaled size> ...` freezes at the scale in force when that module
// loaded, so it does not follow a scale change. Such a size belongs in a function instead.
const KNOWN_FROZEN_DERIVATIONS = [];

test("no new module-scope constant is derived from a scaled size", () => {
    const found = [];
    for (const path of sourceFiles("src/client").concat(sourceFiles("src/mods"))) {
        if (path.endsWith("/UiScale.js")) {
            continue;
        }
        const source = readFileSync(path, "utf8");
        const names = scaledNamesImportedBy(source);
        if (names.length === 0) {
            continue;
        }
        for (const line of source.split("\n")) {
            // Column zero: a const inside a function re-evaluates per call and is never frozen.
            if (!line.startsWith("const ")) {
                continue;
            }
            if (names.some(name => new RegExp(`\\b${name}\\b`).test(line))) {
                found.push(`${path}: ${line.trim()}`);
            }
        }
    }
    assert.deepEqual(found, KNOWN_FROZEN_DERIVATIONS);
});

/**
 * The local names a module binds to UiScale's scaled sizes, aliases resolved. Names re-exported
 * through another module (PanelRow's ROW_HEIGHT) carry the same hazard and are not found here.
 * @param {string} source
 * @returns {string[]}
 */
function scaledNamesImportedBy(source) {
    const statement = source.match(/import\s*\{([^}]*)\}\s*from\s*"@\/client\/hud\/UiScale\.js"/);
    if (statement === null) {
        return [];
    }
    return statement[1].split(",").map((clause) => {
        const parts = clause.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
    }).filter(name => name.length > 0);
}

/**
 * @param {string} directory
 * @returns {string[]} every .js file under it, recursively
 */
function sourceFiles(directory) {
    const paths = [];
    for (const entry of readdirSync(directory)) {
        const path = `${directory}/${entry}`;
        if (statSync(path).isDirectory()) {
            paths.push(...sourceFiles(path));
        } else if (entry.endsWith(".js")) {
            paths.push(path);
        }
    }
    return paths;
}
