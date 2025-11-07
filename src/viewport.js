import {isMobile} from "pixi.js";
import Keyboard from "@/keyboard.js";

/**
 * @param viewport {Viewport}
 */
export function freezeViewport(viewport) {
    viewport.plugins.pause("drag");
    // viewport.plugins.pause("wheel");
    if (isMobile.any) {
        viewport.plugins.pause("pinch");
    }
}

/**
 * @param viewport {Viewport}
 */
export function unfreezeViewport(viewport) {
    viewport.plugins.resume("drag");
    // viewport.plugins.resume("wheel");
    if (isMobile.any) {
        viewport.plugins.resume("pinch");
    }
}

let wasdTickerCallback = null;

function createWasdTickerCallback(viewport, callback) {

    function tickerCallback() {
        const INCREMENT = 8 * (1 / viewport.scaled);

        let deltaX = 0;
        let deltaY = 0;

        if (Keyboard.keyIsDown("w")) {
            deltaY = -INCREMENT;
        }

        if (Keyboard.keyIsDown("a")) {
            deltaX = -INCREMENT;
        }

        if (Keyboard.keyIsDown("s")) {
            deltaY = INCREMENT;
        }

        if (Keyboard.keyIsDown("d")) {
            deltaX = INCREMENT;
        }

        if (deltaX !== 0 || deltaY !== 0) {
            viewport.moveCenter(viewport.center.x + deltaX, viewport.center.y + deltaY);

            callback();
        }
    }

    return tickerCallback;
}

/**
 * @param app
 * @param viewport {Viewport}
 * @param callback {Function}
 */
export function activateWASDPan(app, viewport, callback) {

    if (wasdTickerCallback != null) {
        return;
    }

    wasdTickerCallback = createWasdTickerCallback(viewport, callback);

    app.ticker.add(wasdTickerCallback);
}

export function deactivateWASDPan(app) {
    if (wasdTickerCallback == null) {
        return;
    }

    app.ticker.remove(wasdTickerCallback);
}