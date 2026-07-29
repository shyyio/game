import Mouse from "@/client/Mouse.js";

/**
 * A held-back HUD touch's snapshot; the pooled pixi event can't be stashed itself.
 */
class HeldTouch {

    /**
     * @param {number} pointerId
     * @param {string} pointerType
     * @param {Point} global
     */
    constructor(
        pointerId,
        pointerType,
        global,
    ) {
        this.pointerId = pointerId;
        this.pointerType = pointerType;
        this.global = global;
    }
}

/**
 * Mobile-only input glue: keeps the app fullscreen and routes HUD-origin touches into the
 * viewport's pinch tracker.
 */
export class MobileTouchInput {

    /**
     * @param {Application} app
     * @param {ClientViewport} viewport
     */
    constructor(
        app,
        viewport,
    ) {
        this._stage = app.stage;
        this._viewport = viewport;
        // pointerId -> held-back HUD touch, replayed into the tracker when a pinch partner lands.
        this._heldHudTouches = new Map();
    }

    /**
     * @returns {void}
     */
    install() {
        // Fullscreen demotes Android's edge-back gesture; needs a user gesture, so
        // (re)request on any press.
        window.addEventListener("pointerdown", () => {
            if (document.fullscreenElement === null && document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(() => {});
            }
        }, {capture: true});
        // The transition swallows the exit gesture's pointerup, stranding ghost touches;
        // drop all pointer state on the switch.
        document.addEventListener("fullscreenchange", () => {
            this._viewport.input.clear();
            this._heldHudTouches.clear();
            Mouse.cancelInteraction();
        });
        // Stage-capture listeners route HUD-origin touches into the pinch tracker, but only
        // once a second finger shows pinch intent; a lone HUD touch is held back so it never
        // pans the world underneath.
        this._stage.eventMode = "static";
        this._stage.addEventListener("pointerdown", (e) => this._handlePointerDown(e), {capture: true});
        for (const type of ["pointerup", "pointercancel"]) {
            this._stage.addEventListener(type, (e) => {
                if (e.pointerType === "touch") {
                    this._heldHudTouches.delete(e.pointerId);
                    this._viewport.input.up(e);
                }
            }, {capture: true});
        }
    }

    /**
     * @private
     * @param {FederatedPointerEvent} e
     * @returns {void}
     */
    _handlePointerDown(e) {
        if (e.pointerType !== "touch") {
            return;
        }
        if (this._overWorld(e.target)) {
            // Natively delivered to the viewport; a held HUD finger joins it for the pinch.
            this._flushHeldHudTouches();
            return;
        }
        if (this._viewport.input.count() >= 1 || this._heldHudTouches.size >= 1) {
            this._flushHeldHudTouches();
            this._viewport.input.down(e);
            return;
        }
        this._heldHudTouches.set(e.pointerId, new HeldTouch(e.pointerId, e.pointerType, e.global.clone()));
    }

    /**
     * Whether the hit target sits under the viewport (the world) rather than a HUD element.
     * @private
     * @param {Container} target
     * @returns {boolean}
     */
    _overWorld(target) {
        let node = target;
        while (node != null) {
            if (node === this._viewport) {
                return true;
            }
            node = node.parent;
        }
        return false;
    }

    /**
     * @private
     * @returns {void}
     */
    _flushHeldHudTouches() {
        for (const touch of this._heldHudTouches.values()) {
            this._viewport.input.down(touch);
        }
        this._heldHudTouches.clear();
    }
}
