import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

const LONG_PRESS_MS = 400;

function tilesInPath(x1, y1, x2, y2) {

    const tiles = [];

    x1 = Math.floor(x1 / TILE_SIZE);
    y1 = Math.floor(y1 / TILE_SIZE);
    x2 = Math.floor(x2 / TILE_SIZE);
    y2 = Math.floor(y2 / TILE_SIZE);

    const dx = x2 - x1;
    const dy = y2 - y1;

    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    const xIncr = dx / steps;
    const yIncr = dy / steps;

    let prevTileX = null;
    let prevTileY = null;

    let x = x1;
    let y = y1;
    for (let i = 0; i <= steps; i += 1) {
        let tileX = Math.round(x);
        let tileY = Math.round(y);

        if (tileX === prevTileX && tileY === prevTileY) {
            continue;
        }

        // Insert an axis-aligned intermediate tile to avoid diagonal steps. Guarded
        // on a real previous tile: on the first iteration prevTileX/Y are null, and
        // `null + 1 === 1` would spuriously match a first tile at (1, 1) and prepend a
        // bogus tile, leaving the real start tile duplicated (a zero-length step).
        if (prevTileX !== null) {
            if (tileX === prevTileX - 1 && tileY === prevTileY - 1) {
                tiles.push([tileX, tileY + 1]);
            } else if (tileX === prevTileX + 1 && tileY === prevTileY - 1) {
                tiles.push([tileX, tileY + 1]);
            } else if (tileX === prevTileX - 1 && tileY === prevTileY + 1) {
                tiles.push([tileX, tileY - 1]);
            } else if (tileX === prevTileX + 1 && tileY === prevTileY + 1) {
                tiles.push([tileX, tileY - 1]);
            }
        }

        tiles.push([tileX, tileY]);

        x += xIncr;
        y += yIncr;

        prevTileX = tileX;
        prevTileY = tileY;
    }

    return tiles;
}


class Mouse {
    constructor() {
        this._clickStartX = null;
        this._clickStartY = null;
        this._clickStartTileX = null;
        this._clickStartTileY = null;
        this._clickStartScreenX = null;
        this._clickStartScreenY = null;
        this._longPressTimer = null;
        this._hasDragged = false;

        this.currentX = null;
        this.currentY = null;

        this._hoverTileX = null;
        this._hoverTileY = null;
        this._hoverEnabled = true;
        // After the mini-menu closes, hover is held until the cursor next moves at all
        // (any pixel), so selecting an entry doesn't re-inspect under a stationary cursor.
        this._hoverSuppressed = false;
        this._suppressAnchorX = null;
        this._suppressAnchorY = null;
        // Mobile-mode lock: while a tool is active the "cursor" is pinned to the
        // screen center, so hover and tap-to-place use the center tile and the
        // player pans the map to aim (see setCenterLock).
        this._centerLock = false;

        this._viewport = null;
        this._app = null;

        this._tapCallbacks = [];
        this._dragStartCallbacks = [];
        this._tileDragCallbacks = [];
        this._longPressCallbacks = [];
        this._tileEnterCallbacks = [];
        this._tileExitCallbacks = [];
    }

    /**
     * @param {FederatedPointerEvent} event
     * @returns {Point}
     */
    _worldFromEvent(event) {
        return this._viewport.toWorld(event.data.global.x, event.data.global.y);
    }

    /**
     * @param {Application} app
     * @param {Viewport} viewport
     */
    init(app, viewport) {
        if (this._viewport != null) {
            return;
        }

        this._viewport = viewport;
        this._app = app;

        app.canvas.addEventListener("contextmenu", e => e.preventDefault());

        this._viewport.on("pointerdown", event => this._handlePointerDown(event));
        this._viewport.on("pointerup",   event => this._handlePointerUp(event));

        this._app.ticker.add(() => this._updateCurrentMousePos());
    }

    // ---- Callback registration ----

    /**
     * Left-click (or touch tap) on a tile with no dragging.
     * @param {function(tileX: number, tileY: number)} callback
     */
    onTap(callback) {
        this._tapCallbacks.push(callback);
    }

    /**
     * @callback tileDragCallback
     * @param {number} tileX - destination tile x
     * @param {number} tileY - destination tile y
     * @param {Direction} direction - cardinal direction of this step
     */

    /**
     * @param {tileDragCallback} callback
     */
    onTileDrag(callback) {
        this._tileDragCallbacks.push(callback);
    }

    /**
     * A drag gesture began; fires once before the first onTileDrag with the start tile.
     * @param {function(tileX: number, tileY: number)} callback
     */
    onDragStart(callback) {
        this._dragStartCallbacks.push(callback);
    }

    /**
     * The context gesture: a left button held on the same tile for LONG_PRESS_MS
     * without dragging (touch long-press), or a desktop right-click.
     * @param {function(tileX: number, tileY: number, screenX: number, screenY: number)} callback
     */
    onLongPress(callback) {
        this._longPressCallbacks.push(callback);
    }

    /**
     * Cursor moved onto a new tile (hover; fires regardless of button state).
     * @param {function(tileX: number, tileY: number)} callback
     */
    onTileEnter(callback) {
        this._tileEnterCallbacks.push(callback);
    }

    /**
     * Cursor left the tile it was hovering.
     * @param {function(tileX: number, tileY: number)} callback
     */
    onTileExit(callback) {
        this._tileExitCallbacks.push(callback);
    }

    /**
     * Toggles tile enter/exit hover events, off in map mode.
     * @param {boolean} enabled
     */
    setHoverEnabled(enabled) {
        this._hoverEnabled = enabled;
    }

    /**
     * Re-enables hover but holds it until the cursor next moves (any pixel), then
     * resumes with an enter for whatever tile it lands on. Used when the mini-menu
     * closes, so selecting an entry doesn't re-inspect under a stationary cursor.
     */
    resumeHoverOnMove() {
        this._hoverEnabled = true;
        this._hoverSuppressed = true;
        this._suppressAnchorX = this._app.renderer.events.pointer.global.x;
        this._suppressAnchorY = this._app.renderer.events.pointer.global.y;
    }

    /**
     * Toggles center-lock (mobile mode): hover/tap use the screen-center tile and re-evaluate immediately.
     * @param {boolean} enabled
     */
    setCenterLock(enabled) {
        this._centerLock = enabled;
        this._updateHoverTile();
    }

    /**
     * Abandons the in-flight gesture without firing tap/drag/long-press, when a second finger lands (a pinch).
     */
    cancelInteraction() {
        if (this._longPressTimer != null) {
            window.clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
        this._clickStartX = null;
        this._clickStartY = null;
        this._clickStartTileX = null;
        this._clickStartTileY = null;
        this._clickStartScreenX = null;
        this._clickStartScreenY = null;
        this._hasDragged = false;
    }

    // ---- Getters ----

    get tileX() {
        return Math.floor(this.currentX / TILE_SIZE);
    }

    get tileY() {
        return Math.floor(this.currentY / TILE_SIZE);
    }

    /**
     * The tile under the screen center, used as the gesture target while
     * center-lock is on.
     * @private
     * @returns {{tileX: number, tileY: number}}
     */
    _centerTile() {
        const world = this._viewport.toWorld(
            this._viewport.screenWidth / 2,
            this._viewport.screenHeight / 2,
        );
        return {
            tileX: Math.floor(world.x / TILE_SIZE),
            tileY: Math.floor(world.y / TILE_SIZE),
        };
    }

    // ---- Internal handlers ----

    _handlePointerDown(event) {
        if (event.button === 2) {
            // A right-click is the desktop equivalent of a touch long-press, so it
            // fires the same context gesture. Stop the native event too: the
            // mini-menu installs a window-level pointerdown click-off listener as
            // it opens, and without this the very press that opened it would bubble
            // up and close it again.
            event.stopPropagation();
            event.nativeEvent.stopPropagation();
            const world = this._worldFromEvent(event);
            const tileX = Math.floor(world.x / TILE_SIZE);
            const tileY = Math.floor(world.y / TILE_SIZE);
            // Clear the hovered tile first so the active tool's ghost preview drops
            // while the context gesture is up, matching the long-press path.
            this._emitTileExit();
            this._longPressCallbacks.forEach(cb => {
                cb(tileX, tileY, event.data.global.x, event.data.global.y);
            });
            return;
        }

        if (this._clickStartX != null) {
            // A press is already in flight, so this is a second finger: a pinch,
            // not a tap or long-press. Drop the single-finger gesture so the pinch
            // can't fire a tap or open the mini-menu.
            this.cancelInteraction();
            return;
        }

        const world = this._worldFromEvent(event);
        this._clickStartX = world.x;
        this._clickStartY = world.y;
        this._clickStartTileX = Math.floor(world.x / TILE_SIZE);
        this._clickStartTileY = Math.floor(world.y / TILE_SIZE);
        this._clickStartScreenX = event.data.global.x;
        this._clickStartScreenY = event.data.global.y;
        this._hasDragged = false;

        // Center-lock (mobile, tool active) has no context gesture — orientation is
        // set by the rotate buttons and a tap places — so the long-press timer is
        // only armed for the mini-menu when the cursor isn't locked to center.
        if (this._centerLock) {
            return;
        }

        this._longPressTimer = window.setTimeout(() => {
            this._longPressTimer = null;
            this._hasDragged = true;
            // The long-press opens the mini-menu; clear the hovered tile first so
            // the active tool's ghost preview drops while it is up.
            this._emitTileExit();
            this._longPressCallbacks.forEach(cb => {
                cb(this._clickStartTileX, this._clickStartTileY, this._clickStartScreenX, this._clickStartScreenY);
            });
        }, LONG_PRESS_MS);
    }

    _handlePointerUp(event) {
        if (this._clickStartX == null) {
            return;
        }

        if (this._longPressTimer != null) {
            window.clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }

        if (!this._hasDragged) {
            const dx = event.data.global.x - this._clickStartScreenX;
            const dy = event.data.global.y - this._clickStartScreenY;
            if (dx * dx + dy * dy > 64) {
                this._hasDragged = true;
            }
        }

        if (!this._hasDragged) {
            // Center-lock places under the screen center, not where the finger
            // landed: the mouse is treated as locked to center.
            let tapTileX = this._clickStartTileX;
            let tapTileY = this._clickStartTileY;
            if (this._centerLock) {
                ({tileX: tapTileX, tileY: tapTileY} = this._centerTile());
            }
            this._tapCallbacks.forEach(cb => cb(tapTileX, tapTileY));
        }

        this._clickStartX = null;
        this._clickStartY = null;
        this._clickStartTileX = null;
        this._clickStartTileY = null;
        this._clickStartScreenX = null;
        this._clickStartScreenY = null;
        this._hasDragged = false;
    }

    _updateCurrentMousePos() {
        const world = this._viewport.toWorld(
            this._app.renderer.events.pointer.global.x,
            this._app.renderer.events.pointer.global.y,
        );

        this.currentX = world.x;
        this.currentY = world.y;

        this._resumeHoverIfMoved();
        this._updateHoverTile();

        if (this._clickStartX == null) {
            return;
        }

        if (this._centerLock) {
            // The cursor is locked to center, so finger movement pans the viewport
            // (left to the pan plugin) and never paints. The release still becomes a
            // tap only if the finger barely moved (the screen-distance check in
            // _handlePointerUp), so a pan doesn't place.
            return;
        }

        if (this._longPressTimer != null) {
            const screenDx = this._app.renderer.events.pointer.global.x - this._clickStartScreenX;
            const screenDy = this._app.renderer.events.pointer.global.y - this._clickStartScreenY;
            if (screenDx * screenDx + screenDy * screenDy > 64) {
                window.clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
        }

        const startXTile = Math.floor(this._clickStartX / TILE_SIZE);
        const startYTile = Math.floor(this._clickStartY / TILE_SIZE);
        const currentXTile = Math.floor(this.currentX / TILE_SIZE);
        const currentYTile = Math.floor(this.currentY / TILE_SIZE);

        if (startXTile === currentXTile && startYTile === currentYTile) {
            return;
        }

        if (!this._hasDragged) {
            this._hasDragged = true;
            if (this._longPressTimer != null) {
                window.clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
            this._dragStartCallbacks.forEach(cb => cb(startXTile, startYTile));
        }

        const tiles = tilesInPath(this._clickStartX, this._clickStartY, this.currentX, this.currentY);

        let x = startXTile;
        let y = startYTile;

        tiles.slice(1).forEach(tile => {
            const direction = Direction.fromDelta(tile[0] - x, tile[1] - y);
            this._tileDragCallbacks.forEach(cb => cb(tile[0], tile[1], direction));
            x = tile[0];
            y = tile[1];
        });

        this._clickStartX = this.currentX;
        this._clickStartY = this.currentY;
    }

    /**
     * Lifts the post-menu hover hold once the cursor moves at all, clearing the
     * hovered tile so the next update fires an enter for the current tile.
     * @private
     */
    _resumeHoverIfMoved() {
        if (!this._hoverSuppressed) {
            return;
        }
        const global = this._app.renderer.events.pointer.global;
        if (global.x === this._suppressAnchorX && global.y === this._suppressAnchorY) {
            return;
        }
        this._hoverSuppressed = false;
        this._hoverTileX = null;
        this._hoverTileY = null;
    }

    /**
     * Fires tile enter/exit callbacks when the hovered tile changes.
     * @private
     */
    _updateHoverTile() {
        if (!this._hoverEnabled || this._hoverSuppressed) {
            return;
        }

        let tileX = this.tileX;
        let tileY = this.tileY;
        if (this._centerLock) {
            // Locked to center: hover the tile under the screen center so the ghost
            // tracks the center as the player pans (this runs every ticker frame).
            ({tileX, tileY} = this._centerTile());
        }

        if (tileX === this._hoverTileX && tileY === this._hoverTileY) {
            return;
        }

        if (this._hoverTileX != null) {
            this._tileExitCallbacks.forEach(cb => cb(this._hoverTileX, this._hoverTileY));
        }

        this._hoverTileX = tileX;
        this._hoverTileY = tileY;
        this._tileEnterCallbacks.forEach(cb => cb(tileX, tileY));
    }

    /**
     * Fires a tile-exit for the currently hovered tile, if any, and forgets it
     * so the next hover update re-enters cleanly.
     * @private
     */
    _emitTileExit() {
        if (this._hoverTileX == null) {
            return;
        }

        this._tileExitCallbacks.forEach(cb => cb(this._hoverTileX, this._hoverTileY));
        this._hoverTileX = null;
        this._hoverTileY = null;
    }
}

export default new Mouse();
