import {EMPTY} from "@/sim/sentinels.js";

/**
 * Declares (or clears) `port`'s fluid source based on whether `item` is a declared fluid payload —
 * lets a pipe network type itself off a producer before the first payload actually arrives.
 * @param {GameEngine} engine
 * @param {number} port
 * @param {number} item
 * @returns {void}
 */
export function syncFluidSource(engine, port, item) {
    if (item !== EMPTY && engine.isFluid(item)) {
        engine.setPortFluidSource(port, item);
    } else {
        engine.setPortFluidSource(port, EMPTY);
    }
}
