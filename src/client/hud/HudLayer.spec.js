import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {Container} from "pixi.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

// The bands, back to front; the enum's own order is the documented stacking order.
const ORDER = [
    "WATERMARK",
    "WORLD_MARKER",
    "CONTROL",
    "ROTATE_CONTROL",
    "EDGE_BAR",
    "OVERLAY_BUTTON",
    "TOOLTIP",
    "PANEL",
    "POPOVER",
    "STATUS",
    "NOTICE",
    "DIALOG",
];

test("the bands rise from back to front", () => {
    assert.deepEqual(Object.keys(HudLayer), ORDER);
    for (let i = 1; i < ORDER.length; i += 1) {
        assert.ok(
            HudLayer[ORDER[i]] > HudLayer[ORDER[i - 1]],
            `${ORDER[i]} must sit above ${ORDER[i - 1]}`,
        );
    }
});

test("a higher band draws over a lower one whatever order they mount in", () => {
    const stage = new Container();
    const panel = new Container();
    panel.zIndex = HudLayer.PANEL;
    const dialog = new Container();
    dialog.zIndex = HudLayer.DIALOG;
    // The dialog mounts first, so only its band can put it on top.
    stage.addChild(dialog);
    stage.addChild(panel);
    stage.sortChildren();

    assert.equal(stage.children[stage.children.length - 1], dialog);
});

test("layers sharing a band keep the order they mounted in", () => {
    const stage = new Container();
    const first = new Container();
    first.zIndex = HudLayer.PANEL;
    const second = new Container();
    second.zIndex = HudLayer.PANEL;
    stage.addChild(first);
    stage.addChild(second);
    stage.sortChildren();

    assert.deepEqual(stage.children, [first, second]);
});

test("no layer stamps a raw zIndex, in pixi or in the DOM", () => {
    // A layer ordering its own children by world position computes a zIndex rather than stamping
    // a literal, so only a literal is an offense.
    const stamped = /\bzIndex\s*(=|:)\s*("?\d)/;
    const offenders = [];
    for (const path of sourceFiles("src/client").concat(sourceFiles("src/mods"))) {
        if (path.endsWith("/HudLayer.js")) {
            continue;
        }
        for (const line of readFileSync(path, "utf8").split("\n")) {
            if (stamped.test(line)) {
                offenders.push(`${path}: ${line.trim()}`);
            }
        }
    }
    assert.deepEqual(offenders, []);
});

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
