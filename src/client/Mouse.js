
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

        // Insert an axis-aligned intermediate tile to avoid diagonal steps
        if (tileX === prevTileX - 1 && tileY === prevTileY - 1) {
            tiles.push([tileX, tileY + 1]);
        } else if (tileX === prevTileX + 1 && tileY === prevTileY - 1) {
            tiles.push([tileX, tileY + 1]);
        } else if (tileX === prevTileX - 1 && tileY === prevTileY + 1) {
            tiles.push([tileX, tileY - 1]);
        } else if (tileX === prevTileX + 1 && tileY === prevTileY + 1) {
            tiles.push([tileX, tileY - 1]);
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

        this._viewport = null;
        this._app = null;

        this._tapCallbacks = [];
        this._tileDragCallbacks = [];
        this._longPressCallbacks = [];
        this._rightClickCallbacks = [];
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
     * Left button held on the same tile for LONG_PRESS_MS without dragging.
     * @param {function(tileX: number, tileY: number, screenX: number, screenY: number)} callback
     */
    onLongPress(callback) {
        this._longPressCallbacks.push(callback);
    }

    /**
     * Right-click (or equivalent) on a tile.
     * @param {function(tileX: number, tileY: number, screenX: number, screenY: number)} callback
     */
    onRightClick(callback) {
        this._rightClickCallbacks.push(callback);
    }

    // ---- Getters ----

    get tileX() {
        return Math.floor(this.currentX / TILE_SIZE);
    }

    get tileY() {
        return Math.floor(this.currentY / TILE_SIZE);
    }

    // ---- Internal handlers ----

    _handlePointerDown(event) {
        if (event.button === 2) {
            event.stopPropagation();
            const world = this._worldFromEvent(event);
            const tileX = Math.floor(world.x / TILE_SIZE);
            const tileY = Math.floor(world.y / TILE_SIZE);
            this._rightClickCallbacks.forEach(cb => cb(tileX, tileY, event.data.global.x, event.data.global.y));
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

        this._longPressTimer = window.setTimeout(() => {
            this._longPressTimer = null;
            this._hasDragged = true;
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
            this._tapCallbacks.forEach(cb => cb(this._clickStartTileX, this._clickStartTileY));
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

        if (this._clickStartX == null) {
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
}

export default new Mouse();
