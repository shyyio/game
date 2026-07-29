/**
 * Singleton applying the device fullscreen preference; entering needs a user gesture, so
 * while the preference is on any press (re)enters.
 */
class Fullscreen {

    constructor() {
        this._enabled = false;
    }

    /**
     * Attaches the press listener that (re)enters fullscreen while the preference is on.
     * @returns {void}
     */
    install() {
        window.addEventListener("pointerdown", () => {
            if (this._enabled) {
                this._request();
            }
        }, {capture: true});
    }

    /**
     * Applies the fullscreen preference; entering needs a user gesture, so call from one.
     * @param {boolean} on
     * @returns {void}
     */
    setEnabled(on) {
        this._enabled = on;
        if (on) {
            this._request();
        } else if (document.fullscreenElement !== null && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _request() {
        if (document.fullscreenElement === null && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }
}

export default new Fullscreen();
