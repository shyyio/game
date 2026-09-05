import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {contrastRatio, requiredRatio, tinted, composited, LEVEL_AA, LEVEL_AAA} from "@/client/contrast.js";
import {centerPixel} from "@/test/png.js";
import * as Theme from "@/client/Theme.js";
import * as TextInput from "@/client/hud/TextInput.js";

const UI_SPRITES = "src/client/CoreTextures/sprites/ui/";

// The level each theme is held to: the high-contrast one exists to clear AAA.
const THEME_LEVELS = [
    {themeId: Theme.THEME_DEFAULT, level: LEVEL_AA},
    {themeId: Theme.THEME_HIGH_CONTRAST, level: LEVEL_AAA},
];

/**
 * @param {string} name - a sprite in {@link UI_SPRITES}
 * @param {number} tint
 * @returns {number} what the eye sees where that 9-slice stretches
 */
function surface(name, tint) {
    return tinted(centerPixel(`${UI_SPRITES}${name}.png`), tint);
}

/**
 * Every non-debug pixi Text in the client and what it sits on, in the palette currently applied.
 * Text over the world (map labels, debug overlays, cursors) is in UNCHECKED_TEXTS: its background
 * is whatever the player built there.
 * @returns {object[]}
 */
function themedTexts() {
    // Panels are tinted 9-slices: the color is the sprite's own pixel times the tint.
    const frame = surface("Frame02a", Theme.PANEL_TINT);
    const inset = surface("Frame02a_inset2", Theme.PANEL_TINT);
    const slot = surface("Frame02a_inset4", Theme.PANEL_TINT);
    const buttonActive = surface("Frame02a_inset4", Theme.ACTIVE_ACCENT);
    const buttonInactive = surface("Frame02a_inset4", Theme.PANEL_BORDER);
    const progressBar = surface("barfill", Theme.PROGRESS_BAR_TINT);
    // Circular buttons are a translucent dark fill over the world; a white backdrop is the worst
    // case, lightening the fill most under light text.
    const circleButton = composited(Theme.PANEL_FILL, Theme.PANEL_FILL_ALPHA, 0xffffff);
    // A text input's box is its own near-opaque fill over the inset it sits in.
    const inputBox = composited(TextInput.BOX_FILL, TextInput.BOX_FILL_ALPHA, inset);
    return [
        {where: "UIPanel title", fill: Theme.PANEL_TITLE_TEXT, background: frame, fontSize: 18, bold: true},
        {where: "ConfirmDialogLayer title", fill: Theme.PANEL_TINT_TEXT, background: inset, fontSize: 18, bold: true},
        {where: "ConfirmDialogLayer message", fill: Theme.PANEL_TINT_TEXT, background: inset, fontSize: 15, bold: false},
        {where: "NoticeLayer text", fill: Theme.PANEL_TINT_TEXT, background: inset, fontSize: 15, bold: false},
        {where: "StatusMessageLayer text", fill: Theme.PANEL_TINT_TEXT, background: inset, fontSize: 15, bold: false},
        {where: "AbstractEdgeBarLayer text", fill: Theme.PANEL_TINT_TEXT, background: inset, fontSize: 20, bold: false},
        {where: "PanelText header", fill: Theme.PANEL_TINT_TEXT, background: inset, fontSize: 15, bold: true},
        {where: "PanelText body", fill: Theme.PANEL_TINT_TEXT, background: inset, fontSize: 15, bold: false},
        {where: "PanelText muted", fill: Theme.PANEL_TINT_TEXT, alpha: 0.7, background: inset, fontSize: 15, bold: false},
        {where: "PanelText caption", fill: Theme.PANEL_TINT_TEXT, alpha: 0.7, background: inset, fontSize: 12, bold: false},
        {where: "ProductionLogPanelLayer category header (complete)", fill: Theme.SUCCESS_TEXT, background: inset, fontSize: 15, bold: true},
        {where: "ProductionLogPanelLayer category caption (complete)", fill: Theme.SUCCESS_TEXT, background: inset, fontSize: 12, bold: false},
        {where: "ToolbarLayer slot label", fill: Theme.PANEL_TINT_TEXT, background: slot, fontSize: 15, bold: false},
        {where: "ToolbarLayer shortcut badge", fill: Theme.PANEL_TINT_TEXT, alpha: 0.6, background: slot, fontSize: 45, bold: false},
        // textOn picks each label from its tint. A disabled button fades whole and is AA-exempt,
        // so only the enabled tints are checked.
        {where: "panelButton label (accent)", fill: Theme.textOn(Theme.ACTIVE_ACCENT), background: buttonActive, fontSize: 15, bold: true},
        {where: "toggle segment label (inactive)", fill: Theme.textOn(Theme.PANEL_BORDER), background: buttonInactive, fontSize: 15, bold: true},
        {where: "RotateButtonsLayer icon", fill: Theme.PANEL_TEXT, background: circleButton, fontSize: 28, bold: true},
        // The label is centered over the whole bar, so it sits on filled blocks or bare bar, by progress.
        {where: "InspectProgressBar label (filled)", fill: Theme.PROGRESS_TEXT_COLOR, background: progressBar, fontSize: 15, bold: true},
        {where: "InspectProgressBar label (empty)", fill: Theme.PROGRESS_TEXT_COLOR, background: slot, fontSize: 15, bold: true},
        {where: "InspectContent worker row (staffed)", fill: Theme.WORKER_OK_TEXT, background: slot, fontSize: 15, bold: true},
        {where: "InspectContent worker row (missing)", fill: Theme.WORKER_MISSING_TEXT, background: slot, fontSize: 15, bold: true},
        // A text input's own near-opaque white box, whatever panel surface it sits on.
        {where: "TextInput value", fill: TextInput.TEXT_COLOR, background: inputBox, fontSize: TextInput.FONT_SIZE, bold: false},
        {where: "TextInput placeholder", fill: TextInput.PLACEHOLDER_COLOR, background: inputBox, fontSize: TextInput.FONT_SIZE, bold: false},
        // The slot and note tooltips are flat filled boxes, not tinted 9-slices.
        {where: "SlotTooltip name", fill: Theme.PANEL_TINT_TEXT, background: Theme.PANEL_TINT, fontSize: 15, bold: false},
        {where: "HoverTooltip text", fill: Theme.PANEL_TINT_TEXT, background: Theme.PANEL_TINT, fontSize: 15, bold: false},
        {where: "InspectTooltipLayer text", fill: Theme.PANEL_TINT_TEXT, background: Theme.PANEL_TINT, fontSize: 15, bold: false},
        {where: "NoteTooltipLayer text", fill: Theme.PANEL_TINT_TEXT, background: Theme.PANEL_TINT, fontSize: 15, bold: false},
        {where: "NoteTooltipLayer author", fill: Theme.PANEL_BORDER, background: Theme.PANEL_TINT, fontSize: 15, bold: false},
    ];
}

// pixi Text constructions per file, so a new one has to be classified before this suite passes:
// checked here, or listed as drawn over the world.
const CHECKED_TEXTS = {
    "src/client/hud/AbstractEdgeBarLayer.js": 1,
    "src/client/hud/ConfirmDialogLayer.js": 2,
    "src/client/hud/InspectContent.js": 1,
    "src/client/hud/InspectProgressBar.js": 1,
    "src/client/hud/NoticeLayer.js": 1,
    "src/client/hud/PanelText.js": 1,
    "src/client/hud/RotateButtonsLayer.js": 1,
    "src/client/hud/StatusMessageLayer.js": 1,
    "src/client/hud/TextInput.js": 2,
    "src/client/hud/ToolbarLayer.js": 2,
    "src/client/hud/UIPanel.js": 1,
    "src/client/hud/panelButton.js": 1,
    "src/mods/notes/client/NoteTooltipLayer.js": 2,
};
const UNCHECKED_TEXTS = {
    "src/client/hud/CounterListLayer.js": 1,
    // The cell label sits over whatever tinted icon the cell holds.
    "src/client/hud/IconPicker.js": 1,
    "src/client/hud/VersionWatermarkLayer.js": 1,
    "src/client/layers/ChunkClaimsDrawLayer.js": 1,
    "src/client/layers/WorkerDebugLayer.js": 1,
    "src/mods/cursor-sync/client/RemoteCursorsDrawLayer.js": 1,
    "src/mods/fluids/client/NetworkDebugDrawLayer.js": 1,
};

/**
 * The ratio a reader gets: a translucent glyph fades into its background. A text stroke earns no
 * credit - a 1px outline is a halo around the glyph, not a background the glyph is read against.
 * @param {object} entry
 * @returns {number}
 */
function effectiveRatio(entry) {
    let fill = entry.fill;
    if (entry.alpha !== undefined) {
        fill = composited(fill, entry.alpha, entry.background);
    }
    return contrastRatio(fill, entry.background);
}

for (const {themeId, level} of THEME_LEVELS) {
    test(`every HUD text meets WCAG ${level} in the ${Theme.THEME_NAMES[themeId]} theme`, () => {
        Theme.applyTheme(themeId);
        const failures = [];
        for (const entry of themedTexts()) {
            const ratio = effectiveRatio(entry);
            const required = requiredRatio(entry.fontSize, entry.bold, level);
            if (ratio < required) {
                failures.push(
                    `${entry.where}: #${entry.fill.toString(16).padStart(6, "0")} on `
                    + `#${entry.background.toString(16).padStart(6, "0")} is ${ratio.toFixed(2)}:1, needs ${required}:1`
                );
            }
        }
        Theme.applyTheme(Theme.THEME_DEFAULT);
        assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
    });
}

test("every theme defines every themed color", () => {
    const names = [...Theme.themedColorNames()].sort();
    for (const {themeId} of THEME_LEVELS) {
        assert.deepEqual(Object.keys(Theme.palette(themeId)).sort(), names, Theme.THEME_NAMES[themeId]);
    }
    assert.equal(THEME_LEVELS.length, Theme.THEME_NAMES.length, "a theme was added without a contrast level");
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
