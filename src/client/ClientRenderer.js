import {Assets, Container, Graphics} from "pixi.js";
import beltLeft from "@/assets/belt-left.png";
import beltRight from "@/assets/belt-right.png";
import beltStraight from "@/assets/belt-straight.png";
import beltRampUp from "@/assets/belt-ramp-up.png";
import beltRampDown from "@/assets/belt-ramp-down.png";
import splitter from "@/assets/splitter.png";
import {DEBUG_COLOR} from "@/constants.js";
import {drawCircle, drawLine} from "@/pixiUtils.js";
import {BeltContainer} from "@/client/belt.js";
import {ChunkGridContainer} from "@/client/chunk.js";
import {ItemContainer} from "@/client/item.js";
import {OverlayContainer} from "@/client/overlay.js";
import {ObjectContainer} from "@/client/object.js";

/**
 * @enum {string}
 */
export const GameTextures = {
    BELT_LEFT: "BELT_LEFT",
    BELT_RIGHT: "BELT_RIGHT",
    BELT_STRAIGHT: "BELT_STRAIGHT",
    BELT_RAMP_UP: "BELT_RAMP_UP",
    BELT_RAMP_DOWN: "BELT_RAMP_DOWN",
    Splitter: "Splitter",
}

export let CircleTexture = null;

export default class ClientRenderer {

    /**
     * @param app {Application}
     * @param viewport {Viewport}
     */
    constructor(app, viewport) {
        this.app = app;
        this.viewport = viewport;

        this.gridContainer = new ChunkGridContainer();
        this.beltContainer = new BeltContainer();
        this.objectContainer = new ObjectContainer();
        this.itemContainer = new ItemContainer(this.beltContainer.itemMask);
        this.overlayContainer = new OverlayContainer();

        this.debugContainer = new Container();

        this.viewport.addChild(this.gridContainer);
        this.viewport.addChild(this.beltContainer);
        this.viewport.addChild(this.objectContainer);
        this.viewport.addChild(this.itemContainer);
        this.viewport.addChild(this.overlayContainer);

        this.viewport.addChild(this.debugContainer);

        this._lastScale = 0;

        this.app.ticker.add(ticker => {

            if (this._lastScale !== this.viewport.scaled) {
                this.handleScaleChange(this.viewport.scaled);
            }

            this.itemContainer.tick(ticker);

            this.overlayContainer.tick(ticker);
        });
    }

    /**
     * @param chunk {string}
     */
    drawChunkGrid(chunk) {
        this.gridContainer.addChunk(chunk);
    }

    /**
     * @param chunk {string}
     */
    removeChunkGrid(chunk) {
        this.gridContainer.removeChunk(chunk);
    }

    sortChunkGrid() {
        this.gridContainer.sortChildren();
    }

    /**
     * @param scale {Number}
     */
    handleScaleChange(scale) {

        if (scale < 0.25) {
            this.gridContainer.lowRes = true;
            this.beltContainer.lowRes = true;
            this.overlayContainer.lowRes = true;
        } else {
            this.gridContainer.lowRes = false;
            this.beltContainer.lowRes = false;
            this.overlayContainer.lowRes = false;
        }

        this._lastScale = scale;
    }


    async loadTextures() {

        await Assets.load({alias: GameTextures.BELT_STRAIGHT, src: beltStraight, data: {scalingMode: "nearest"}});
        await Assets.load({alias: GameTextures.BELT_LEFT, src: beltLeft, data: {scalingMode: "nearest"}});
        await Assets.load({alias: GameTextures.BELT_RIGHT, src: beltRight, data: {scalingMode: "nearest"}});
        await Assets.load({alias: GameTextures.BELT_RAMP_UP, src: beltRampUp, data: {scalingMode: "nearest"}});
        await Assets.load({alias: GameTextures.BELT_RAMP_DOWN, src: beltRampDown, data: {scalingMode: "nearest"}});
        await Assets.load({alias: GameTextures.Splitter, src: splitter, data: {scalingMode: "nearest"}});

        const g = new Graphics();
        g.circle(0, 0, 16)
            .stroke({color: 0xFF00FF, width: 3});

        CircleTexture = this.app.renderer.generateTexture(g);
    }

    /**
     *
     * @param belt {Belt}
     */
    drawBelt(belt) {
        this.beltContainer.addBelt(belt);
    }

    hideBelt(id) {
        this.beltContainer.hideBelt(id)
    }

    /**
     * @param name {GameObject}
     * @param object {ObjectInfo}
     */
    drawObject(name, object) {
        this.objectContainer.addObject(name, object);
    }

    removeObject(name, id) {
        this.objectContainer.removeObject(name, id);
    }


    /**
     * @param id {BigInt}
     */
    removeBelt(id) {
        this.beltContainer.removeBelt(id);
    }

    removeItem(id) {
        this.itemContainer.removeItem(id);
    }

    drawBeltPathItems(path) {
        this.itemContainer.drawBeltPathItems(path);
    }

    highlightUndergroundBelt(x1, y1, x2, y2) {
        this.overlayContainer.highlightUndergroundBelt(x1, y1, x2, y2);
    }

    clearHighlights() {
        this.overlayContainer.clearHighlights();
    }

    /**
     * @param paths {{BigInt: BeltPath}}
     */
    drawBeltPathDebug(paths) {
        return

        this.debugContainer.children.forEach(child => {
            child.destroy();
            this.debugContainer.removeChild(child);
        });

        const g = new Graphics();

        Object.values(paths).forEach(path => {

            const belts = path.parts.map(id => this.belts[id]);

            if (belts.length === 0 || belts.some(b => b === undefined)) {
                return
            }

            const color = DEBUG_COLOR(path.id);

            for (let i = 0; i < belts.length - 1; i += 1) {
                drawLine(g, belts[i].x, belts[i].y, belts[i + 1].x, belts[i + 1].y, color);
            }

            drawCircle(g, belts[0].x, belts[0].y, 10, color);

            if (belts.length > 1) {
                const end = belts[belts.length - 1];
                drawCircle(g, end.x, end.y, 10, color);
            }
        });

        this.debugContainer.addChild(g);
    }
}