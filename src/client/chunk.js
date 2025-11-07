import {Container, Graphics} from "pixi.js";
import {getChunkCoords} from "@/util.js";
import {CHUNK_SIZE, TILE_SIZE} from "@/constants.js";

export class ChunkGridContainer extends Container {

    constructor() {
        super();

        this._chunks = {};
        this._minorVisible = true;
    }

    /**
     * @param chunk {string}
     */
    addChunk(chunk) {

        const {x, y} = getChunkCoords(chunk);

        const sprite = ChunkGridContainer.createChunkGrid(x * CHUNK_SIZE, y * CHUNK_SIZE);
        sprite.children[1].visible = !this._minorVisible;
        this._chunks[chunk] = sprite;
        this.addChild(sprite);
    }

    /**
     * @param chunk {string}
     */
    removeChunk(chunk) {
        const sprite = this._chunks[chunk];

        if (sprite === undefined) {
            return;
        }

        sprite.destroy();
        this.removeChild(sprite);
    }

    set lowRes(value) {
        this._minorVisible = value;

        this.children.forEach(grid => {
            grid.children[1].visible = !value;
        });
    }

    static createChunkGrid(x, y) {

        const container = new Container();

        const anchorX = x * TILE_SIZE;
        const anchorY = y * TILE_SIZE;

        const gMinor = new Graphics();
        const gMajor = new Graphics();

        // White background + major lines
        gMajor
            .rect(anchorX, anchorY, TILE_SIZE * CHUNK_SIZE, TILE_SIZE * CHUNK_SIZE)
            .fill("white")
            .stroke({color: 0x000000, pixelLine: true, alpha: 0.1});

        // Minor lines
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
