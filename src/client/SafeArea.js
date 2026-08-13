// A hidden probe element is the only way to read env(safe-area-inset-*) from script: the values
// resolve in CSS, so they are set as padding and read back computed.
const PROBE_STYLE = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;"
    + "padding:env(safe-area-inset-top) env(safe-area-inset-right)"
    + " env(safe-area-inset-bottom) env(safe-area-inset-left);";

/**
 * Singleton reading the device's safe-area insets (notch, rounded corners, home indicator).
 */
class SafeArea {

    constructor() {
        this._probe = null;
    }

    /**
     * The insets in CSS pixels, for HUD layers laying out in screen space.
     * @returns {{top: number, right: number, bottom: number, left: number}}
     */
    insets() {
        const style = window.getComputedStyle(this._probeElement());
        return {
            top: Number.parseFloat(style.paddingTop),
            right: Number.parseFloat(style.paddingRight),
            bottom: Number.parseFloat(style.paddingBottom),
            left: Number.parseFloat(style.paddingLeft),
        };
    }

    /**
     * @private
     * @returns {HTMLElement}
     */
    _probeElement() {
        if (this._probe === null) {
            this._probe = document.createElement("div");
            this._probe.setAttribute("style", PROBE_STYLE);
            document.body.appendChild(this._probe);
        }
        return this._probe;
    }
}

export default new SafeArea();
