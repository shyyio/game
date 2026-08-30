import {Tween, easeOutBack} from "@/client/layers/Tween.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import {moveWithin} from "@/client/input/ToolOrder.js";

// How large the picked-up icon grows, and how long it takes to get there.
const LIFT_SCALE = 1.12;
const LIFT_DURATION_MS = 150;

/**
 * One in-progress mod-tool reorder drag: the lifted icon and its scale tween, plus the working copy
 * of the mod-tool order that reorders live as the drag crosses slots.
 */
export class ToolReorderDrag {

    /**
     * @param {AbstractTool} tool - the dragged tool
     * @param {Sprite} icon - its icon, detached from the slot to follow the pointer
     * @param {AbstractTool[]} startOrder - the mod-tool order the drag picked up from
     * @param {function(): void} detachTracking - releases the window-level pointer tracking
     */
    constructor(tool, icon, startOrder, detachTracking) {
        this.tool = tool;
        this.icon = icon;
        this.order = [...startOrder];
        this._startOrder = startOrder;
        this._iconBaseScale = icon.scale.x;
        this._detachTracking = detachTracking;
        this._lift = new Tween(1, LIFT_DURATION_MS);
        if (ReducedMotion.enabled) {
            this._lift.reset(LIFT_SCALE);
        } else {
            this._lift.to(LIFT_SCALE, easeOutBack);
        }
    }

    /**
     * @returns {boolean} whether the working order differs from the one the drag picked up from
     */
    get reordered() {
        return this.order.some((tool, i) => tool !== this._startOrder[i]);
    }

    /**
     * Moves the dragged tool to `index` in the working order.
     * @param {number} index
     * @returns {boolean} whether the order changed
     */
    moveTo(index) {
        if (index === this.order.indexOf(this.tool)) {
            return false;
        }
        moveWithin(this.order, this.tool, index);
        return true;
    }

    /**
     * Advances the lift tween by `deltaMs` and scales the icon to it.
     * @param {number} deltaMs
     * @returns {void}
     */
    advanceLift(deltaMs) {
        this.icon.scale.set(this._iconBaseScale * this._lift.advance(deltaMs));
    }

    /**
     * Returns the icon to its resting scale, ready to reattach to a slot.
     * @returns {void}
     */
    settleIcon() {
        this.icon.scale.set(this._iconBaseScale);
    }

    /**
     * Releases the pointer tracking and destroys the lifted icon, committing nothing.
     * @returns {void}
     */
    cancel() {
        this._detachTracking();
        this.icon.destroy();
    }
}
