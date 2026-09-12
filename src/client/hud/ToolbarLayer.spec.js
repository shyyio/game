import {test} from "node:test";
import assert from "node:assert/strict";
import {barToolCapacity, getToolSlotKeybindingOrNull, TOOL_SHORTCUT_COUNT} from "@/client/hud/ToolbarLayer.js";
import {KEYBINDING_TOOL_SLOTS} from "@/common/KeybindingEntry.js";

// The layer itself needs a renderer, but its layout math does not.
const MIN_BAR_TOOLS = 4;
const MAX_BAR_TOOLS_DESKTOP = 10;
const NARROW_SCREEN = 320;
const WIDE_SCREEN = 4000;
const MOBILE = true;
const DESKTOP = false;

test("touch input holds a fixed bar width, however wide the screen", () => {
    assert.equal(barToolCapacity(NARROW_SCREEN, MOBILE), MIN_BAR_TOOLS);
    assert.equal(barToolCapacity(WIDE_SCREEN, MOBILE), MIN_BAR_TOOLS);
});

test("a screen too narrow to fit the minimum still gets the minimum", () => {
    assert.equal(barToolCapacity(NARROW_SCREEN, DESKTOP), MIN_BAR_TOOLS);
});

test("a very wide screen stops at the desktop cap", () => {
    assert.equal(barToolCapacity(WIDE_SCREEN, DESKTOP), MAX_BAR_TOOLS_DESKTOP);
});

test("capacity grows with the screen, between the floor and the cap", () => {
    let previous = 0;
    for (let width = NARROW_SCREEN; width <= WIDE_SCREEN; width += 40) {
        const capacity = barToolCapacity(width, DESKTOP);
        assert.ok(capacity >= previous, `capacity shrank at ${width}px`);
        assert.ok(capacity >= MIN_BAR_TOOLS && capacity <= MAX_BAR_TOOLS_DESKTOP);
        previous = capacity;
    }
    assert.equal(previous, MAX_BAR_TOOLS_DESKTOP);
});

test("the first mod tools take a slot binding", () => {
    assert.equal(getToolSlotKeybindingOrNull(0), KEYBINDING_TOOL_SLOTS[0]);
    assert.equal(getToolSlotKeybindingOrNull(TOOL_SHORTCUT_COUNT - 1), KEYBINDING_TOOL_SLOTS.at(-1));
});

test("a tool past the slot range takes no binding", () => {
    assert.equal(getToolSlotKeybindingOrNull(TOOL_SHORTCUT_COUNT), null);
});

test("a tool missing from the order takes no binding", () => {
    // indexOf returns -1 for a tool that is not a mod tool.
    assert.equal(getToolSlotKeybindingOrNull(-1), null);
});
