import {
    Container,
    EventBoundary,
    FederatedContainer,
    FederatedPointerEvent,
    Rectangle,
    extensions,
    updateRenderGroupTransforms,
} from "pixi.js";

// Pixi installs its event methods on Container from the browser environment bundle, which a node
// test never loads; the boundary calls them during hit testing.
extensions.mixin(Container, FederatedContainer);

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const PRIMARY_BUTTON = 0;
const DEFAULT_POINTER_ID = 1;

/**
 * Drives pointer gestures through a real pixi {@link EventBoundary} with no renderer, so input
 * wiring (buttons, rows, scroll drags) is testable: build a container tree under {@link root}, then
 * play a gesture and assert what fired.
 */
export class PointerHarness {

    /**
     * @param {number} [width] - the screen the root container covers
     * @param {number} [height]
     */
    constructor(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
        this.root = new Container();
        this.root.eventMode = "static";
        this.root.hitArea = new Rectangle(0, 0, width, height);
        // Hit testing reads world transforms, which only a render group computes.
        this.root.enableRenderGroup();
        this._boundary = new EventBoundary(this.root);
        // Mouse unless a gesture says otherwise; touch is the interesting case, so it is explicit.
        this._pointerType = "mouse";
    }

    /**
     * Adds `child` to the root at (x, y), returned for convenience.
     * @template {Container} T
     * @param {T} child
     * @param {number} [x]
     * @param {number} [y]
     * @returns {T}
     */
    add(child, x = 0, y = 0) {
        child.x = x;
        child.y = y;
        this.root.addChild(child);
        return child;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {{pointerId?: number, button?: number, pointerType?: string}} [options]
     * @returns {void}
     */
    down(x, y, options = {}) {
        this._dispatch("pointerdown", x, y, options);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {{pointerId?: number, pointerType?: string}} [options]
     * @returns {void}
     */
    move(x, y, options = {}) {
        this._dispatch("pointermove", x, y, options);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {{pointerId?: number, button?: number, pointerType?: string}} [options]
     * @returns {void}
     */
    up(x, y, options = {}) {
        this._dispatch("pointerup", x, y, options);
    }

    /**
     * A press and release in place.
     * @param {number} x
     * @param {number} y
     * @param {{pointerId?: number, button?: number, pointerType?: string}} [options]
     * @returns {void}
     */
    tap(x, y, options = {}) {
        this.down(x, y, options);
        this.up(x, y, options);
    }

    /**
     * A press at (fromX, fromY), travel to (toX, toY) in `steps` moves, then a release there.
     * @param {number} fromX
     * @param {number} fromY
     * @param {number} toX
     * @param {number} toY
     * @param {{pointerId?: number, button?: number, pointerType?: string, steps?: number}} [options]
     * @returns {void}
     */
    drag(fromX, fromY, toX, toY, options = {}) {
        let steps = options.steps;
        if (steps === undefined) {
            steps = 4;
        }
        this.down(fromX, fromY, options);
        for (let step = 1; step <= steps; step += 1) {
            this.move(
                fromX + (toX - fromX) * (step / steps),
                fromY + (toY - fromY) * (step / steps),
                options,
            );
        }
        this.up(toX, toY, options);
    }

    /**
     * Builds and maps one federated pointer event.
     * @private
     * @param {string} type
     * @param {number} x
     * @param {number} y
     * @param {{pointerId?: number, button?: number, pointerType?: string}} options
     * @returns {void}
     */
    _dispatch(type, x, y, options) {
        // Whatever a handler moved since the last event has to reach the world transforms first.
        updateRenderGroupTransforms(this.root.renderGroup, true);
        const event = new FederatedPointerEvent(this._boundary);
        event.type = type;
        event.pointerId = options.pointerId === undefined ? DEFAULT_POINTER_ID : options.pointerId;
        event.pointerType = options.pointerType === undefined ? this._pointerType : options.pointerType;
        event.button = options.button === undefined ? PRIMARY_BUTTON : options.button;
        event.buttons = type === "pointerup" ? 0 : 1;
        event.isPrimary = true;
        event.global.set(x, y);
        event.screen.set(x, y);
        event.client.set(x, y);
        event.page.set(x, y);
        // The boundary reads through to the native event for propagation control.
        event.nativeEvent = new NativePointerEventStub(type, event.pointerId);
        this._boundary.mapEvent(event);
    }
}

/**
 * Stands in for the DOM event a federated event wraps; records the calls handlers make on it.
 */
export class NativePointerEventStub {

    /**
     * @param {string} type
     * @param {number} pointerId
     */
    constructor(type, pointerId) {
        this.type = type;
        this.pointerId = pointerId;
        this.propagationStopped = false;
        this.defaultPrevented = false;
    }

    /**
     * @returns {void}
     */
    stopPropagation() {
        this.propagationStopped = true;
    }

    /**
     * @returns {void}
     */
    preventDefault() {
        this.defaultPrevented = true;
    }
}
