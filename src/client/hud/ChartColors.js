// Categorical palette (dataviz skill reference); panel bg is a fixed tint, no dark-mode variant.
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const MAX_CATEGORICAL_SERIES = CATEGORICAL.length;

export const INK_MUTED = "#898781";

/**
 * Assigns each series key a persistent categorical color slot, first-seen order; overflow falls back to INK_MUTED.
 */
export class ChartColors {

    constructor() {
        this._indexByKey = new Map();
        this._nextIndex = 0;
    }

    /**
     * @param {string} key
     * @returns {number} categorical slot index, or -1 past the palette's capacity
     */
    indexFor(key) {
        let index = this._indexByKey.get(key);
        if (index === undefined) {
            if (this._nextIndex < MAX_CATEGORICAL_SERIES) {
                index = this._nextIndex;
                this._nextIndex += 1;
            } else {
                index = -1;
            }
            this._indexByKey.set(key, index);
        }
        return index;
    }

    /**
     * @param {string} key
     * @returns {string}
     */
    colorFor(key) {
        const index = this.indexFor(key);
        if (index === -1) {
            return INK_MUTED;
        }
        return CATEGORICAL[index];
    }
}
