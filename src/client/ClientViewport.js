import {Viewport} from "pixi-viewport";

import ReducedMotion from "@/client/ReducedMotion.js";
import Mobile from "@/client/Mobile.js";

// One easing and duration for every scripted viewport move.
const MOVE_MS = 300;
const MOVE_EASE = "easeOutCubic";

/**
 * The game's pan/zoom {@link Viewport}: its wheel rides pixi's hit-testing like every other
 * pointer event, so HUD over the world swallows it the way it swallows a click, and panning can be
 * frozen while a tool paints on drag.
 */
export class ClientViewport extends Viewport {

    /**
     * @param {object} options - pixi-viewport's
     */
    constructor(options) {
        super(options);
        // pixi-viewport's own raw canvas listener would zoom the map under a panel.
        this.input.destroy();
        this.on("wheel", event => this.input.handleWheel(event.nativeEvent));
    }

    /**
     * Glides to a world position and/or scale. `onDone` settles exactly once: arrived=true on
     * completion, false when an interrupt or a newer glide cancels it.
     * @param {{x?: number|null, y?: number|null, scale?: number|null}} target
     * @param {function(arrived: boolean): void|null} [onDone]
     * @returns {void}
     */
    glideTo({x = null, y = null, scale = null}, onDone = null) {
        if (this._glideFinish !== undefined && this._glideFinish !== null) {
            this._glideFinish(false);
        }
        if (ReducedMotion.enabled) {
            if (scale !== null) {
                this.setZoom(scale, true);
                this.emit("zoomed", {viewport: this, type: "animate"});
            }
            if (x !== null) {
                this.moveCenter(x, y);
            }
            // setZoom/moveCenter emit nothing themselves; fire the event a glide would.
            this.emit("moved", {viewport: this, type: "animate"});
            if (onDone !== null) {
                onDone(true);
            }
            return;
        }
        const options = {time: MOVE_MS, ease: MOVE_EASE, removeOnInterrupt: true};
        if (scale !== null) {
            options.scale = scale;
        }
        if (x !== null) {
            options.position = {x, y};
        }
        if (onDone !== null) {
            const interrupt = () => this._glideFinish(false);
            this._glideFinish = (arrived) => {
                this._glideFinish = null;
                this.off("pointerdown", interrupt);
                onDone(arrived);
            };
            this.on("pointerdown", interrupt);
            options.callbackOnComplete = () => {
                if (this._glideFinish !== null) {
                    this._glideFinish(true);
                }
            };
        }
        this.animate(options);
    }

    /**
     * Freezes panning (drag, plus pinch on touch) while leaving zoom available.
     */
    freezePan() {
        this.plugins.pause("drag");
        if (Mobile.enabled) {
            this.plugins.pause("pinch");
        }
    }

    /**
     * Resumes the panning frozen by {@link ClientViewport#freezePan}.
     */
    unfreezePan() {
        this.plugins.resume("drag");
        if (Mobile.enabled) {
            this.plugins.resume("pinch");
        }
    }
}
