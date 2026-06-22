import {DrawLayer} from "@/client/DrawLayer.js";
import {Container, Graphics} from "pixi.js";
import {chunkCoords} from "@/util.js";
import {TILE_SIZE} from "@/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {EVENT_TYPE_CORE, EVENT_SUBTYPE_CHUNK_SUBSCRIBE, EVENT_SUBTYPE_CHUNK_UNSUBSCRIBE} from "@/common/core.js";

export class GridDrawLayer extends DrawLayer {

    constructor() {
        super();
        this._chunks = {};
        this._lowRes = false;
    }

    get zLevel() {
        return 0;
    }

    /**
     * @param {string} chunk
     */
    addChunk(chunk) {
        if (this._chunks[chunk] !== undefined) {
            return;
        }

        const {x, y} = chunkCoords(chunk);
        const sprite = GridDrawLayer._createChunkGrid(x * CHUNK_SIZE, y * CHUNK_SIZE);
        sprite.children[1].visible = !this._lowRes;
        this._chunks[chunk] = sprite;
        this.addChild(sprite);
    }

    /**
     * @param {string} chunk
     */
    removeChunk(chunk) {
        const sprite = this._chunks[chunk];

        if (sprite === undefined) {
            return;
        }

        sprite.destroy();
        this.removeChild(sprite);
        delete this._chunks[chunk];
    }

    set lowRes(value) {
        this._lowRes = value;
        this.children.forEach(grid => {
            grid.children[1].visible = !value;
        });
    }

    onEvent(event) {
        if (event.type !== EVENT_TYPE_CORE) {
            return;
        }

        if (event.subtype === EVENT_SUBTYPE_CHUNK_SUBSCRIBE) {
            this.addChunk(event.chunk);
        } else if (event.subtype === EVENT_SUBTYPE_CHUNK_UNSUBSCRIBE) {
            this.removeChunk(event.chunk);
        }
    }

    static _createChunkGrid(x, y) {
        const container = new Container();

        const anchorX = x * TILE_SIZE;
        const anchorY = y * TILE_SIZE;

        const gMinor = new Graphics();
        const gMajor = new Graphics();

        gMajor
            .rect(anchorX, anchorY, TILE_SIZE * CHUNK_SIZE, TILE_SIZE * CHUNK_SIZE)
            .fill("white")
            .stroke({color: 0x000000, pixelLine: true, alpha: 0.1});

        for (let i = 0; i < CHUNK_SIZE; i++) {
            gMinor
                .moveTo(anchorX + i * TILE_SIZE, anchorY)
                .lineTo(anchorX + i * TILE_SIZE, anchorY + CHUNK_SIZE * TILE_SIZE);

            gMinor
                .moveTo(anchorX, anchorY + i * TILE_SIZE)
                .lineTo(anchorX + CHUNK_SIZE * TILE_SIZE, anchorY + i * TILE_SIZE);
        }

        gMinor.stroke({color: 0x000000, pixelLine: true, alpha: 0.075});

        container.addChild(gMajor);
        container.addChild(gMinor);
        container.zIndex = x + y;

        return container;
    }
}
