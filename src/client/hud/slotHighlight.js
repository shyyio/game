import {Graphics} from "pixi.js";
import {SLOT_HIGHLIGHT_COLOR} from "@/client/Theme.js";

// A slot's active/hover highlight: a filled rect inside the slot, shown solid-ish when active and
// fainter on hover. Insets are on-screen px (= 2x texture): 2 texture px bottom/left, 1 top/right.
const HIGHLIGHT_ACTIVE_ALPHA = 0.5;
const HIGHLIGHT_HOVER_ALPHA = 0.2;
const INSET_LEFT = 4;
const INSET_TOP = 2;
const INSET_RIGHT = 2;
const INSET_BOTTOM = 4;

/**
 * Adds the active/hover highlight rect to a slot-sized container, wiring hover automatically. Call
 * before adding the slot's icon so the highlight sits behind it.
 * @param {Container} target - the slot container (made interactive for hover)
 * @param {number} size - the slot's square size
 * @returns {{setActive: function(boolean): void}} handle to toggle the active state
 */
export function addSlotHighlight(target, size) {
    const graphics = new Graphics();
    graphics.rect(INSET_LEFT, INSET_TOP, size - INSET_LEFT - INSET_RIGHT, size - INSET_TOP - INSET_BOTTOM)
        .fill(SLOT_HIGHLIGHT_COLOR);
    graphics.visible = false;
    target.addChild(graphics);

    let active = false;
    let hovered = false;
    const refresh = () => {
        graphics.visible = active || hovered;
        graphics.alpha = active ? HIGHLIGHT_ACTIVE_ALPHA : HIGHLIGHT_HOVER_ALPHA;
    };

    target.eventMode = "static";
    target.on("pointerenter", () => {
        hovered = true;
        refresh();
    });
    target.on("pointerleave", () => {
        hovered = false;
        refresh();
    });

    return {
        setActive(value) {
            active = value;
            refresh();
        },
    };
}
