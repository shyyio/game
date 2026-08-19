import {Sprite} from "pixi.js";
import Mobile from "@/client/Mobile.js";
import Mouse from "@/client/input/Mouse.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";

// Half an item sprite: a hover reaches an item's own edge, no further.
const HOVER_REACH = TILE_SIZE / 4;
// A fingertip covers more than an item, so a tap aims at the belt.
const TAP_REACH = TILE_SIZE / 2;

/**
 * Brackets the inspected item, suppressing the object highlights while it has one.
 */
export class ItemInspectLayer extends AbstractDrawLayer {

    /**
     * @param {ItemDrawLayer} itemLayer - queried for the item under the cursor
     * @param {InspectLayer} inspectLayer - suppressed while an item is bracketed
     */
    constructor(itemLayer, inspectLayer) {
        super();
        /**
         * @type {ItemDrawLayer}
         * @private
         */
        this._itemLayer = itemLayer;
        /**
         * @type {InspectLayer}
         * @private
         */
        this._inspectLayer = inspectLayer;
        /**
         * The bracket, built on first use (textures load after construction).
         * @type {Sprite|null}
         * @private
         */
        this._sprite = null;
        /**
         * Whether an inspect hover is live; false parks the bracket. Touch ignores it.
         * @type {boolean}
         * @private
         */
        this._inspecting = false;
        /**
         * The locked item, and the type it showed when locked: a pooled particle relit as another
         * item is a different item, and drops the lock.
         * @type {ItemParticle|null}
         * @private
         */
        this._particle = null;
        this._lockedType = null;
        // The aim point the current lock was picked at; a move re-picks.
        this._aimX = null;
        this._aimY = null;
    }

    get layerIndex() {
        // Above the items themselves (15), below the objects carrying them (20).
        return 16;
    }

    /**
     * Never hides itself: the bracket is parked in {@link tick} instead, with the items it marks.
     * @param {boolean} value
     */
    set mapMode(value) {}

    /**
     * @returns {ItemParticle|null} the bracketed item, null while none is locked
     */
    get lockedItem() {
        return this._particle;
    }

    /**
     * Turns the hover pick on or off. Touch drives the lock from {@link tapAt} instead.
     * @param {boolean} inspecting
     * @returns {void}
     */
    setInspecting(inspecting) {
        this._inspecting = inspecting;
    }

    /**
     * Locks the item nearest the tapped point, with a fingertip's reach; a tap off every item
     * clears the lock.
     * @returns {void}
     */
    tapAt() {
        const point = Mouse.aimPoint();
        if (point === null) {
            this._lock(null);
            return;
        }
        this._lock(this._itemLayer.itemAt(point.x, point.y, TAP_REACH));
    }

    /**
     * Re-picks and repositions the bracket, so it rides the locked item's glide.
     * @param {number} frame unused
     * @param {number} deltaMS unused
     * @param {Set<number>} visibleChunks unused
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        // Hidden items (map and overworld mode) are not worth picking.
        if (!this._itemLayer.visible) {
            this._lock(null);
            this._inspectLayer.setSuppressed(false);
            return;
        }
        // Touch synthesizes a hover around every tap, so there the tap alone picks.
        if (!Mobile.enabled) {
            this._pickUnderCursor();
        }
        this._follow();
    }

    /**
     * Locks the item under the cursor, re-picking only once the cursor has moved: a resting
     * cursor keeps the item it caught as the item glides away.
     * @private
     * @returns {void}
     */
    _pickUnderCursor() {
        let aim = null;
        if (this._inspecting) {
            aim = Mouse.aimPoint();
        }
        if (aim === null) {
            this._aimX = null;
            this._aimY = null;
            this._lock(null);
            return;
        }
        if (aim.x === this._aimX && aim.y === this._aimY) {
            return;
        }
        this._aimX = aim.x;
        this._aimY = aim.y;
        this._lock(this._itemLayer.itemAt(aim.x, aim.y, HOVER_REACH));
    }

    /**
     * Points the bracket at the locked item, dropping the lock once the item is gone: pooled,
     * covered, relit as another item, or panned off screen.
     * @private
     * @returns {void}
     */
    _follow() {
        if (this._particle !== null) {
            const lost = !this._particle.pickable
                || this._particle.itemType !== this._lockedType
                || this._offScreen(this._particle);
            if (lost) {
                this._lock(null);
            }
        }
        if (this._particle === null) {
            if (this._sprite !== null) {
                this._sprite.visible = false;
            }
            this._inspectLayer.setSuppressed(false);
            return;
        }
        if (this._sprite === null) {
            this._sprite = new Sprite(this.textureRegistry.get("inspect/item"));
            this._sprite.anchor = 0.5;
            this.addChild(this._sprite);
        }
        this._sprite.visible = true;
        this._sprite.position.set(this._particle.x, this._particle.y);
        this._inspectLayer.setSuppressed(true);
    }

    /**
     * @private
     * @param {ItemParticle} particle
     * @returns {boolean}
     */
    _offScreen(particle) {
        return particle.x < this.viewport.left
            || particle.x > this.viewport.right
            || particle.y < this.viewport.top
            || particle.y > this.viewport.bottom;
    }

    /**
     * @private
     * @param {ItemParticle|null} particle
     * @returns {void}
     */
    _lock(particle) {
        if (particle === this._particle) {
            return;
        }
        this._particle = particle;
        if (particle === null) {
            this._lockedType = null;
        } else {
            this._lockedType = particle.itemType;
        }
    }
}
