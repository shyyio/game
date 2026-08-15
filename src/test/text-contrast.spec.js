import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {contrastRatio, requiredRatio, tinted, composited} from "@/client/contrast.js";
import {centerPixel} from "@/test/png.js";
import {
    PANEL_TEXT, PANEL_TITLE_TEXT, PANEL_TINT_TEXT, PANEL_TINT, PANEL_BORDER, PANEL_FILL,
    PANEL_FILL_ALPHA, ACTIVE_ACCENT, PROGRESS_BAR_TINT, PROGRESS_TEXT_COLOR, PROGRESS_TEXT_STROKE,
    GHOST_BLOCKED_TINT, textOn,
} from "@/client/Theme.js";

const UI_SPRITES = "src/mods/BaseTextures/sprites/main/ui/";

/**
 * @param {string} name - a sprite in {@link UI_SPRITES}
 * @param {number} tint
 * @returns {number} what the eye sees where that 9-slice stretches
 */
function surface(name, tint) {
    return tinted(centerPixel(`${UI_SPRITES}${name}.png`), tint);
}

// What HUD text actually sits on. The panels are tinted 9-slices, so the color is the sprite's own
// pixel times the tint, not the tint alone.
const FRAME = surface("Frame02a", PANEL_TINT);
const INSET = surface("Frame02a_inset2", PANEL_TINT);
const SLOT = surface("Frame02a_inset4", PANEL_TINT);
const BUTTON_ACTIVE = surface("Frame02a_inset4", ACTIVE_ACCENT);
const BUTTON_INACTIVE = surface("Frame02a_inset4", PANEL_BORDER);
const PROGRESS_BAR = surface("barfill", PROGRESS_BAR_TINT);
// Circular map/rotate buttons are a translucent dark fill over the world, which is any color at
// all; a white backdrop is the worst case, lightening the fill most under light text.
const CIRCLE_BUTTON = composited(PANEL_FILL, PANEL_FILL_ALPHA, 0xffffff);

// Every non-debug pixi Text in the client, with what it is drawn over. Text over the world (map
// labels, debug overlays, remote cursors) is in UNCHECKED_TEXTS instead: its background is whatever
// the player built there.
const TEXTS = [
    {where: "ChunkInfoPanelLayer title", fill: PANEL_TITLE_TEXT, background: FRAME, fontSize: 18, bold: true},
    {where: "ChunkInfoPanelLayer info", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 15, bold: false},
    {where: "UIPanel title", fill: PANEL_TITLE_TEXT, background: FRAME, fontSize: 18, bold: true},
    {where: "ConfirmDialogLayer title", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 18, bold: true},
    {where: "ConfirmDialogLayer message", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 15, bold: false},
    {where: "NoticeLayer text", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 15, bold: false},
    {where: "StatusMessageLayer text", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 15, bold: false},
    {where: "TopStatusBarLayer text", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 20, bold: false},
    {where: "PanelText header", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 15, bold: true},
    {where: "PanelText body", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 15, bold: false},
    {where: "PanelText muted", fill: PANEL_TINT_TEXT, background: INSET, fontSize: 15, bold: false},
    {where: "ToolbarLayer slot label", fill: PANEL_TINT_TEXT, background: SLOT, fontSize: 15, bold: false},
    {where: "ToolbarLayer shortcut badge", fill: 0xffffff, alpha: 0.5, stroke: 0x000000, background: SLOT, fontSize: 45, bold: false},
    // textOn picks each button label from its tint; a disabled button is faded whole (text and
    // background together) and is exempt from AA anyway, so only the enabled tints are checked.
    {where: "panelButton label (accent)", fill: textOn(ACTIVE_ACCENT), background: BUTTON_ACTIVE, fontSize: 15, bold: true},
    {where: "toggle segment label (inactive)", fill: textOn(PANEL_BORDER), background: BUTTON_INACTIVE, fontSize: 15, bold: true},
    {where: "RotateButtonsLayer icon", fill: PANEL_TEXT, background: CIRCLE_BUTTON, fontSize: 28, bold: true},
    {where: "InspectContent progress label", fill: PROGRESS_TEXT_COLOR, stroke: PROGRESS_TEXT_STROKE, background: PROGRESS_BAR, fontSize: 15, bold: true},
    {where: "InspectContent worker row (manned)", fill: PROGRESS_BAR_TINT, stroke: PROGRESS_TEXT_STROKE, background: SLOT, fontSize: 15, bold: true},
    {where: "InspectContent worker row (missing)", fill: GHOST_BLOCKED_TINT, stroke: PROGRESS_TEXT_STROKE, background: SLOT, fontSize: 15, bold: true},
];

// pixi Text constructions per file, so a new one has to be classified before this suite passes:
// checked here, or listed as drawn over the world.
const CHECKED_TEXTS = {
    "src/client/hud/ChunkInfoPanelLayer.js": 2,
    "src/client/hud/ConfirmDialogLayer.js": 2,
    "src/client/hud/InspectContent.js": 2,
    "src/client/hud/NoticeLayer.js": 1,
    "src/client/hud/PanelText.js": 1,
    "src/client/hud/RotateButtonsLayer.js": 1,
    "src/client/hud/StatusMessageLayer.js": 1,
    "src/client/hud/ToolbarLayer.js": 2,
    "src/client/hud/TopStatusBarLayer.js": 1,
    "src/client/hud/UIPanel.js": 1,
    "src/client/hud/panelButton.js": 1,
};
const UNCHECKED_TEXTS = {
    "src/client/layers/ChunkClaimsDrawLayer.js": 1,
    "src/client/layers/WorkerDebugLayer.js": 1,
    "src/mods/CursorSync/client/RemoteCursorsDrawLayer.js": 1,
    "src/mods/Fluids/client/NetworkDebugDrawLayer.js": 1,
};

/**
 * The ratio a reader gets: a translucent glyph fades into its background, and an outlined one is
 * read against its own outline when that separates it better.
 * @param {object} entry
 * @returns {number}
 */
function effectiveRatio(entry) {
    let fill = entry.fill;
    if (entry.alpha !== undefined) {
        fill = composited(fill, entry.alpha, entry.background);
    }
    const ratio = contrastRatio(fill, entry.background);
    if (entry.stroke === undefined) {
        return ratio;
    }
    return Math.max(ratio, contrastRatio(fill, entry.stroke));
}

test("every HUD text meets WCAG AA against what it is drawn on", () => {
    const failures = [];
    for (const entry of TEXTS) {
        const ratio = effectiveRatio(entry);
        const required = requiredRatio(entry.fontSize, entry.bold);
        if (ratio < required) {
            failures.push(
                `${entry.where}: #${entry.fill.toString(16).padStart(6, "0")} on `
                + `#${entry.background.toString(16).padStart(6, "0")} is ${ratio.toFixed(2)}:1, needs ${required}:1`
            );
        }
    }
    assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
});

test("every pixi Text in the client is either contrast-checked or drawn over the world", () => {
    const found = {};
    for (const path of sourceFiles("src/client").concat(sourceFiles("src/mods"))) {
        const count = readFileSync(path, "utf8").split("new Text(").length - 1;
        if (count > 0) {
            found[path] = count;
        }
    }
    assert.deepEqual(found, {...CHECKED_TEXTS, ...UNCHECKED_TEXTS});
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
        }
        else if (entry.endsWith(".js")) {
            paths.push(path);
        }
    }
    return paths;
}
