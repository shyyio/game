import {DrawLayer, Graphics, drawLine, drawRect, TILE_SIZE} from "@/sdk/client.js";

export class BeltOverlayDrawLayer extends DrawLayer {

    constructor() {
        super();
        this._highlights = [];
    }

    get zLevel() {
        return 100;
    }

    set lowRes(value) {
        this.visible = !value;
    }

    onEvent(event) {
        // TODO: handle underground belt hover events to show/hide highlights
    }

    highlightUndergroundBelt(x1, y1, x2, y2) {
        this.clearHighlights();

        const g = new Graphics();
        drawLine(g, x1 * TILE_SIZE + 32, y1 * TILE_SIZE + 32, x2 * TILE_SIZE + 32, y2 * TILE_SIZE + 32, 0xD5B60A);
        drawRect(g, x1 * TILE_SIZE, y1 * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0xD5B60A);
        drawRect(g, x2 * TILE_SIZE, y2 * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0xD5B60A);

        this.addChild(g);
        this._highlights.push(g);
    }

    clearHighlights() {
        this._highlights.forEach(g => {
            g.destroy();
            this.removeChild(g);
        });
        this._highlights.splice(0);
    }
}
