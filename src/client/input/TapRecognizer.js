// Pointer travel past this ends a press: it is a drag, and the tap it would have been never fires.
// The same figure is what a scrolling container treats as the start of its drag, so exactly one of
// the two claims any given press.
export const TAP_MOVE_THRESHOLD = 6;

/**
 * Press-to-tap state machine over one target's pointer stream: the first primary-button pointer
 * claims the press, travel past the threshold cancels it, and only that pointer's release counts as
 * a tap. Holds no reference to a display object, so it tests without a renderer.
 */
export class TapRecognizer {

    /**
     * @param {number} [threshold] - travel, in pixels, that turns the press into a drag
     */
    constructor(threshold = TAP_MOVE_THRESHOLD) {
        this._threshold = threshold;
        // The pointer holding the press, null when none does.
        this._pointerId = null;
        this._startX = 0;
        this._startY = 0;
        // Set once travel passes the threshold; never re-arms, so coming back does not restore the tap.
        this._dragged = false;
    }

    /**
     * @returns {boolean} whether a pointer currently holds the press
     */
    get pressed() {
        return this._pointerId !== null;
    }

    /**
     * @returns {number|null} the pointer holding the press, for a caller reading that pointer's travel
     */
    get pointerId() {
        return this._pointerId;
    }

    /**
     * Whether the press has travelled past the threshold: the drag claimed it, and no tap follows.
     * @returns {boolean}
     */
    get dragging() {
        return this._dragged;
    }

    /**
     * Claims the press for `pointerId`, unless another pointer already holds it or this is not the
     * primary button.
     * @param {number} pointerId
     * @param {number} button - 0 is primary
     * @param {number} x
     * @param {number} y
     * @returns {boolean} whether this press was claimed
     */
    press(pointerId, button, x, y) {
        if (button !== 0) {
            return false;
        }
        // A second concurrent pointer (a fat-finger touch, say) must not steal the press.
        if (this._pointerId !== null) {
            return false;
        }
        this._pointerId = pointerId;
        this._startX = x;
        this._startY = y;
        this._dragged = false;
        return true;
    }

    /**
     * Feeds pointer travel; past the threshold the press stops being a tap.
     * @param {number} pointerId
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    move(pointerId, x, y) {
        if (this._pointerId !== pointerId || this._dragged) {
            return;
        }
        if (Math.abs(x - this._startX) + Math.abs(y - this._startY) >= this._threshold) {
            this._dragged = true;
        }
    }

    /**
     * Releases the press.
     * @param {number} pointerId
     * @returns {boolean} whether the release completes a tap
     */
    release(pointerId) {
        if (this._pointerId !== pointerId) {
            return false;
        }
        const tapped = !this._dragged;
        this._pointerId = null;
        this._dragged = false;
        return tapped;
    }

    /**
     * Abandons the press without a tap.
     * @param {number} pointerId
     * @returns {void}
     */
    cancel(pointerId) {
        if (this._pointerId !== pointerId) {
            return;
        }
        this._pointerId = null;
        this._dragged = false;
    }
}
