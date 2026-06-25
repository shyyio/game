import {Viewport} from "pixi-viewport";
import {isMobile} from "pixi.js";

/**
 * The game's pan/zoom {@link Viewport}, with helpers to freeze interaction:
 * panning only (while a tool is active, so cursor drags paint tiles and zoom
 * stays live) or everything (while the direction wheel or mini-menu is open).
 */
export class ClientViewport extends Viewport {

    /**
     * Freezes all viewport interaction (pan, zoom, pinch, decelerate) so the
     * world can't move behind a modal such as the direction wheel.
     */
    freeze() {
        this.pause = true;
    }

    /**
     * Resumes the interaction frozen by {@link ClientViewport#freeze}, handing
     * control back to each plugin's own paused state.
     */
    unfreeze() {
        this.pause = false;
    }

    /**
     * Freezes panning (drag, plus pinch on touch) while leaving zoom available.
     */
    freezePan() {
        this.plugins.pause("drag");
        if (isMobile.any) {
            this.plugins.pause("pinch");
        }
    }

    /**
     * Resumes the panning frozen by {@link ClientViewport#freezePan}.
     */
    unfreezePan() {
        this.plugins.resume("drag");
        if (isMobile.any) {
            this.plugins.resume("pinch");
        }
    }
}
