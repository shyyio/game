import {Sprite} from "pixi.js";
import Mobile from "@/client/Mobile.js";
import Mouse from "@/client/input/Mouse.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";

// Half an item sprite: items render a half-tile wide, so a hover reaches an item's own edge and
// no further.
const HOVER_REACH = TILE_SIZE / 4;
// A fingertip covers more than an item, so a tap reaches the whole tile around it: the player
// aims at the belt, not at the item.
const TAP_REACH = TILE_SIZE / 2;

/**
 * Brackets the inspected item and suppresses the object highlights whenever it has one: an item
 * outranks the belt or machine carrying it.
 *
 * The bracket locks onto the item it picks and rides its glide, so the player aims for an instant
 * and reads for as long as they like. Desktop re-picks whenever the cursor moves; touch, which
 * synthesizes a hover around every tap, picks on the tap alone.
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
         * The locked item's particle, and the type it showed when locked: a pooled particle
         * relit as another item is a different item, and drops the lock.
         * @type {ItemParticle|null}
         * @private
         */
        this._particle = null;
        this._lockedType = null;
        /**
         * Bumped on every new lock, so a reader can tell one item from the next of the same type.
         * @type {number}
         * @private
         */
        this._lockVersion = 0;
        // The aim point the current lock was picked at; a move re-picks.
        this._aimX = null;
        this._aimY = null;
    }

    get layerIndex() {
        // Above the items themselves (15), below the objects carrying them (20).
        return 16;
    }

    /**
     * Stays visible in map mode: the hover highlight reads at any zoom.
     * @param {boolean} value
     */
    set mapMode(value) {}

    /**
     * @returns {number|null} the locked item's type, null while none is locked
     */
    get lockedItemType() {
        return this._lockedType;
    }

    /**
     * @returns {number} a counter identifying the current lock
     */
    get lockVersion() {
        return this._lockVersion;
    }

    /**
     * @returns {{x: number, y: number}|null} the locked item's world position
     */
    get lockedPoint() {
        if (this._particle === null) {
            return null;
        }
        return {x: this._particle.x, y: this._particle.y};
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
     * Locks the item nearest a tapped world point, with a fingertip's reach; a tap landing on no
     * item clears the lock. Null (the pointer position is unknown) clears it too.
     * @param {{x: number, y: number}|null} point
     * @returns {boolean} whether an item was locked
     */
    tapAt(point) {
        if (point === null) {
            this._lock(null);
            return false;
        }
        this._lock(this._itemLayer.itemAt(point.x, point.y, TAP_REACH));
        return this._particle !== null;
    }

    /**
     * Re-picks and repositions the bracket every frame, so it rides the locked item's glide.
     * @param {number} frame unused
     * @param {number} deltaMS unused
     * @param {Set<number>} visibleChunks unused
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        this.refresh();
    }

    /**
     * Re-picks the hovered item and re-applies the object-highlight suppression.
     * @returns {void}
     */
    refresh() {
        if (!Mobile.enabled) {
            this._pickUnderCursor();
        }
        this._follow();
    }

    /**
     * Locks the item under the cursor, re-picking only once the cursor has moved: a resting cursor
     * keeps the item it caught even as the item glides away from it.
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
     * Points the bracket at the locked item, dropping the lock once the item is gone: consumed or
     * pooled (alpha 0), relit as another item, or panned off screen.
     * @private
     * @returns {void}
     */
    _follow() {
        if (this._particle !== null) {
            const lost = this._particle.alpha === 0
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
        const screen = this.viewport.toScreen(particle.x, particle.y);
        return screen.x < 0
            || screen.y < 0
            || screen.x > this.viewport.screenWidth
            || screen.y > this.viewport.screenHeight;
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
        this._lockVersion += 1;
    }
}
