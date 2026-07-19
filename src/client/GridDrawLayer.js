import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {Container, Graphics, GraphicsContext} from "pixi.js";
import {chunkPosition} from "@/common/util.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";

export class GridDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._chunks = {};
        this._mapMode = false;
        // Every chunk's grid is the same geometry: built once, shared by all chunk Graphics.
        this._majorContext = GridDrawLayer._buildMajorContext();
        this._minorContext = GridDrawLayer._buildMinorContext();
    }

    get layerIndex() {
        return 0;
    }

    /**
     * @param {number} chunk
     */
    addChunk(chunk) {
        if (this._chunks[chunk] !== undefined) {
            return;
        }

        const {x, y} = chunkPosition(chunk);
        const tileX = x * CHUNK_SIZE;
        const tileY = y * CHUNK_SIZE;
        const container = new Container();
        container.addChild(new Graphics(this._majorContext));
        const minor = container.addChild(new Graphics(this._minorContext));
        minor.visible = !this._mapMode;
        container.position.set(tileX * TILE_SIZE, tileY * TILE_SIZE);
        container.zIndex = tileX + tileY;
        this._chunks[chunk] = container;
        this.addChild(container);
    }

    /**
     * @param {number} chunk
     */
    removeChunk(chunk) {
        const sprite = this._chunks[chunk];

        if (sprite === undefined) {
            return;
        }

        this.removeChild(sprite);
        // The Graphics views die with the container; the shared contexts live on.
        sprite.destroy({children: true});
        delete this._chunks[chunk];
    }

    set mapMode(value) {
        this._mapMode = value;
        for (const grid of this.children) {
            grid.children[1].visible = !value;
        }
    }

    get eventClasses() {
        return [ChunkSubscribeEvent, ChunkUnsubscribeEvent];
    }

    onEvent(event) {
        if (event instanceof ChunkSubscribeEvent) {
            this.addChunk(event.chunk);
        } else if (event instanceof ChunkUnsubscribeEvent) {
            this.removeChunk(event.chunk);
        }
    }

    /**
     * The chunk outline, origin-relative.
     * @private
     * @returns {GraphicsContext}
     */
    static _buildMajorContext() {
        return new GraphicsContext()
            .rect(0, 0, TILE_SIZE * CHUNK_SIZE, TILE_SIZE * CHUNK_SIZE)
            .fill("white")
            .stroke({color: 0x000000, pixelLine: true, alpha: 0.2});
    }

    /**
     * The tile lines within a chunk, origin-relative.
     * @private
     * @returns {GraphicsContext}
     */
    static _buildMinorContext() {
        const context = new GraphicsContext();
        for (let i = 0; i < CHUNK_SIZE; i++) {
            context
                .moveTo(i * TILE_SIZE, 0)
                .lineTo(i * TILE_SIZE, CHUNK_SIZE * TILE_SIZE);
            context
                .moveTo(0, i * TILE_SIZE)
                .lineTo(CHUNK_SIZE * TILE_SIZE, i * TILE_SIZE);
        }
        context.stroke({color: 0x000000, pixelLine: true, alpha: 0.1});
        return context;
    }
}
