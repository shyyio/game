/**
 * Singleton gating the DOM widgets overlaid on the canvas (text inputs, selectable text). They are
 * real elements floating above every pixi layer, so no pixi band can draw over them: anything that
 * covers the HUD has to suppress them for as long as it is up. Held as a count, so two suppressors
 * cannot uncover each other's.
 */
class DomOverlays {

    constructor() {
        this._suppressors = 0;
    }

    /**
     * @returns {boolean} whether the DOM widgets must stay hidden
     */
    get suppressed() {
        return this._suppressors > 0;
    }

    /**
     * Hides the DOM widgets until the returned release is called.
     * @returns {function(): void} releases this suppression
     */
    suppress() {
        this._suppressors += 1;
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this._suppressors -= 1;
        };
    }
}

export default new DomOverlays();
