/**
 * The toolbar's cell grid as pure geometry: where a flat slot index rests, and which slot a dragged
 * icon is nearest. Holds no display objects, so it tests without a renderer.
 */
export class ToolGrid {

    /**
     * @param {object} metrics
     * @param {number} metrics.columns
     * @param {number} metrics.left - x of the first column
     * @param {number} metrics.top - y of the first row
     * @param {number} metrics.slotSize - the square icon slot, which is also a cell's width
     * @param {number} metrics.cellHeight - the slot plus the label strip reserved under it
     * @param {number} metrics.columnGap
     * @param {number} metrics.rowGap
     */
    constructor({columns, left, top, slotSize, cellHeight, columnGap, rowGap}) {
        this.columns = columns;
        this.left = left;
        this.top = top;
        this.slotSize = slotSize;
        this.cellHeight = cellHeight;
        this.columnGap = columnGap;
        this.rowGap = rowGap;
    }

    /**
     * The rest position of the cell at `flatIndex`, counting left to right then down.
     * @param {number} flatIndex
     * @returns {{x: number, y: number}}
     */
    slotPosition(flatIndex) {
        return {
            x: this.left + (flatIndex % this.columns) * (this.slotSize + this.columnGap),
            y: this.top + Math.floor(flatIndex / this.columns) * (this.cellHeight + this.rowGap),
        };
    }

    /**
     * Which of the `count` slots starting at `firstFlatIndex` has its slot center nearest
     * (centerX, centerY), as an offset from that first index.
     * @param {number} centerX
     * @param {number} centerY
     * @param {number} firstFlatIndex
     * @param {number} count
     * @returns {number}
     */
    nearestSlot(centerX, centerY, firstFlatIndex, count) {
        if (count < 1) {
            throw new Error("nearestSlot over an empty range");
        }
        let best = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < count; i += 1) {
            const position = this.slotPosition(firstFlatIndex + i);
            const dx = (position.x + this.slotSize / 2) - centerX;
            const dy = (position.y + this.slotSize / 2) - centerY;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        }
        return best;
    }
}
