import {Container} from "pixi.js";
import {createArrow, createRect, createText} from "@/pixiUtils.js";
import {snapToTile, TILE_SIZE} from "@/constants.js";

/**
 * @callback tileDragCallback
 * @param  x1 {Number}
 * @param  y1 {Number}
 * @param  x2 {Number}
 * @param  y2 {Number}
 */

function tilesInPath(x1, y1, x2, y2) {

    const tiles = [];
    
    x1 = snapToTile(x1) / TILE_SIZE;
    y1 = snapToTile(y1) / TILE_SIZE;
    x2 = snapToTile(x2) / TILE_SIZE;
    y2 = snapToTile(y2) / TILE_SIZE;

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

        // Add a tile to avoid diagonals
        if (tileX === prevTileX - 1 && tileY === prevTileY - 1) {
            tiles.push([tileX, tileY + 1, true]);
        }
        else if (tileX === prevTileX + 1 && tileY === prevTileY - 1) {
            tiles.push([tileX, tileY + 1, true]);
        }
        else if (tileX === prevTileX - 1 && tileY === prevTileY + 1) {
            tiles.push([tileX, tileY - 1, true]);
        }
        else if (tileX === prevTileX + 1 && tileY === prevTileY + 1) {
            tiles.push([tileX, tileY - 1, true]);
        }

        tiles.push([tileX, tileY]);

        x += xIncr;
        y += yIncr;

        prevTileX = tileX;
        prevTileY = tileY;
    }

    return tiles.map(([x, y, c]) => [x * TILE_SIZE, y * TILE_SIZE, c]);
}


class Mouse {
    constructor() {
        this._clickStartX = null;
        this._clickStartY = null;

        this.currentX = null;
        this.currentY = null;

        this._viewport = null;
        this._app = null;

        this._debugContainer = new Container();
        this._debugPath = null;
    }

    /**
     * @param event
     * @returns {Point}
     * @private
     */
    _getWorldCoordsFromEvent(event) {
        return this._getWorldCoords(event.data.global.x, event.data.global.y);
    }

    _getWorldCoords(x, y) {
        return this._viewport.toWorld(x, y);
    }

    /**
     * @param app {Application}
     * @param viewport {Viewport}
     */
    init(app, viewport) {
        if (this._viewport != null) {
            return;
        }

        this._viewport = viewport;
        this._app = app;

        this._viewport.on("pointerdown", event => this._handlePointerDown(event));
        this._viewport.on("pointerup", event => this._handlePointerUp(event));
        this._viewport.on("pointermove", event => this._handleMove(event));

        this._viewport.addChild(this._debugContainer);

        this._app.ticker.add(() => {
            this._updateCurrentMousePos();
            // this._drawDebug();
        })

        this._tileDragCallbacks = [];
        this._clickCallbacks = [];
    }


    /**
     * @param callback {tileDragCallback}
     */
    onTileDrag(callback) {
        this._tileDragCallbacks.push(callback);
    }

    onClick(callback) {
        this._clickCallbacks.push(callback);
    }

    _tileDrag(x1, y1, x2, y2) {
        this._tileDragCallbacks.forEach(
            cb => cb(x1, y1, x2, y2)
        );
    }

    get tileX() {
        return Math.floor(this.currentX / TILE_SIZE);
    }

    get tileY() {
        return Math.floor(this.currentY / TILE_SIZE);
    }

    _updateCurrentMousePos() {
        const worldCoords = this._getWorldCoords(
            this._app.renderer.events.pointer.global.x,
            this._app.renderer.events.pointer.global.y,
        );

        this.currentX = worldCoords.x;
        this.currentY = worldCoords.y;

        if (this._clickStartX !== null) {
            const startXTile = snapToTile(this._clickStartX) / TILE_SIZE;
            const startYTile = snapToTile(this._clickStartY) / TILE_SIZE;
            const currentXTile = snapToTile(this.currentX) / TILE_SIZE;
            const currentYTile = snapToTile(this.currentY) / TILE_SIZE;

            if (startXTile !== currentXTile || startYTile !== currentYTile) {
                const tiles = tilesInPath(this._clickStartX, this._clickStartY, this.currentX, this.currentY);

                let x = startXTile;
                let y = startYTile;

                tiles.slice(1).forEach(
                    tile => {
                        this._tileDrag(x, y, tile[0] / TILE_SIZE, tile[1] / TILE_SIZE);
                        x = tile[0] / TILE_SIZE;
                        y = tile[1] / TILE_SIZE;
                    }
                );

                this._clickStartX = this.currentX;
                this._clickStartY = this.currentY;

                this._debugPath = tiles;
            }
        }
    }

    _drawDebug() {
        this._debugContainer.children.forEach(child => {
            child.destroy();
            this._debugContainer.removeChild(child);
        })

        // Drag
        if (this._clickStartX != null) {
            this._debugContainer.addChild(
                createArrow(this._clickStartX, this._clickStartY, this.currentX, this.currentY)
            );
        }

        // Tiles
        if (this._debugPath != null) {
            let i = 0;
            this._debugPath.forEach(p => {
                i += 1;
                this._debugContainer.addChild(
                    createRect(
                        p[0] + 3,
                        p[1] + 3,
                        TILE_SIZE - 6,
                        TILE_SIZE - 6,
                        p[2] ? 0x00FF00 : 0xFF00FF
                    )
                );
                this._debugContainer.addChild(
                    createText(
                        p[0] + TILE_SIZE / 2,
                        p[1] + TILE_SIZE / 2,
                        `${i}`
                    )
                );
            });
        }
    }

    _handleMove(event) {
    }

    _handlePointerDown(event) {
        if (event.button === 2) {
            event.stopPropagation()
            return;
        }
        const worldCoords = this._getWorldCoordsFromEvent(event);

        this._clickStartX = worldCoords.x;
        this._clickStartY = worldCoords.y;

        this._clickCallbacks.forEach(cb => cb(this.tileX, this.tileY));
    }

    _handlePointerUp(event) {
        const worldCoords = this._getWorldCoordsFromEvent(event);

        this._clickStartX = null;
        this._clickStartY = null;
        this._previousTileX = null;
        this._previousTileY = null;
        this._debugPath = null;
    }
}

export default new Mouse();