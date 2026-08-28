import {AbstractDrawLayer, Graphics, Mouse, TILE_SIZE} from "@spup/sdk/client";
import {DRAW_LAYER_WIRES} from "../common/constants.js";

/**
 * The canonical key of a pole-pole wire.
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
function wireKey(a, b) {
    return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

const WIRE_COLOR = 0x33302c;
const WIRE_WIDTH = 2;
const WIRE_ALPHA = 0.9;
// The in-progress wire preview draws lighter.
const PREVIEW_ALPHA = 0.55;
// Sag scales with span, capped so long wires stay readable.
const SAG_FACTOR = 0.12;
const SAG_MAX = 22;
// Perspective tilt: screen-vertical distance is this fraction of the true ground distance, and
// the hang projects by it. 1 = flat (no correction).
const SAG_TILT = 1;

/**
 * Catenary overlay: pole-pole wires from the synced wire set, device-pole wires from the synced
 * link map. Redraws whole on any change.
 */
export class WireDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._graphics = new Graphics();
        this.addChild(this._graphics);
        // The wiring tool's in-progress wire, following the pointer; redrawn per frame.
        this._preview = new Graphics();
        this.addChild(this._preview);
        this._previewFrom = null;
        this._previewSnap = null;
        /**
         * Pole objectId -> its cache entry.
         * @type {Map<number, CacheEntry>}
         */
        this._poles = new Map();
        /**
         * Device objectId -> wired pole objectId.
         * @type {Map<number, number>}
         */
        this._links = new Map();
        /**
         * Wire key -> its {a, b} pole objectIds.
         * @type {Map<string, {a: number, b: number}>}
         */
        this._edges = new Map();
        /**
         * @type {ObjectsView|null}
         */
        this._objects = null;
        this._stale = false;
    }

    get layerIndex() {
        return DRAW_LAYER_WIRES;
    }

    /**
     * @param {ObjectsView} objects
     * @returns {void}
     */
    bindObjects(objects) {
        this._objects = objects;
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    addPole(entry) {
        this._poles.set(entry.id, entry);
        this._stale = true;
    }

    /**
     * A removed pole drops its edges too; re-subscribing re-syncs them.
     * @param {number} id
     * @returns {void}
     */
    removePole(id) {
        this._poles.delete(id);
        for (const [key, edge] of [...this._edges]) {
            if (edge.a === id || edge.b === id) {
                this._edges.delete(key);
            }
        }
        this._stale = true;
    }

    /**
     * @param {number} a - pole objectId
     * @param {number} b
     * @returns {void}
     */
    setEdge(a, b) {
        this._edges.set(wireKey(a, b), {a, b});
        this._stale = true;
    }

    /**
     * @param {number} a - pole objectId
     * @param {number} b
     * @returns {void}
     */
    removeEdge(a, b) {
        if (this._edges.delete(wireKey(a, b))) {
            this._stale = true;
        }
    }

    /**
     * @param {number} a - pole objectId
     * @param {number} b
     * @returns {boolean}
     */
    hasEdge(a, b) {
        return this._edges.has(wireKey(a, b));
    }

    /**
     * Sets or clears (poleId undefined) a device's wire.
     * @param {number} deviceId
     * @param {number|undefined} poleId
     * @returns {void}
     */
    setLink(deviceId, poleId) {
        if (poleId === undefined) {
            this._links.delete(deviceId);
        } else {
            this._links.set(deviceId, poleId);
        }
        this._stale = true;
    }

    /**
     * A removed device drops its wire.
     * @param {number} deviceId
     * @returns {void}
     */
    removeDevice(deviceId) {
        if (this._links.delete(deviceId)) {
            this._stale = true;
        }
    }

    tick(frame, deltaMS, visibleChunks) {
        this._updatePreview();
        if (!this._stale) {
            return;
        }
        this._stale = false;
        this._redraw();
    }

    /**
     * Starts the in-progress wire: it follows the pointer each frame, snapping to `snap`'s anchor
     * while one is hovered.
     * @param {CacheEntry} from - the selected pole or device
     * @param {CacheEntry|null} snap - the hovered wireable endpoint, if any
     * @returns {void}
     */
    showPreview(from, snap) {
        this._previewFrom = from;
        this._previewSnap = snap;
    }

    /**
     * Redraws the pointer-following preview.
     * @private
     * @returns {void}
     */
    _updatePreview() {
        if (this._previewFrom === null) {
            return;
        }
        this._preview.clear();
        let to = {x: Mouse.currentX, y: Mouse.currentY};
        if (this._previewSnap !== null) {
            to = WireDrawLayer._anchor(this._previewSnap);
        } else if (to.x === undefined || to.x === null) {
            return;
        }
        this._drawWireInto(this._preview, WireDrawLayer._anchor(this._previewFrom), to);
        this._preview.stroke({width: WIRE_WIDTH, color: WIRE_COLOR, alpha: PREVIEW_ALPHA});
    }

    /**
     * An endpoint's wire anchor: the type's declared wireAnchor offset from its origin tile, the
     * footprint center as the fallback for an entry that lost its anchor.
     * @private
     * @param {CacheEntry} entry
     * @returns {{x: number, y: number}}
     */
    static _anchor(entry) {
        const anchor = entry.data.type.wireAnchor;
        if (anchor === null) {
            const centroid = entry.tileCentroid;
            return {
                x: (centroid.tileX + 0.5) * TILE_SIZE,
                y: (centroid.tileY + 0.5) * TILE_SIZE,
            };
        }
        return {
            x: (entry.tileX + anchor.x) * TILE_SIZE,
            y: (entry.tileY + anchor.y) * TILE_SIZE,
        };
    }

    /**
     * @returns {void}
     */
    clearPreview() {
        this._previewFrom = null;
        this._previewSnap = null;
        this._preview.clear();
    }

    /**
     * @private
     * @returns {void}
     */
    _redraw() {
        const graphics = this._graphics;
        graphics.clear();
        for (const edge of this._edges.values()) {
            const a = this._poles.get(edge.a);
            const b = this._poles.get(edge.b);
            if (a === undefined || b === undefined) {
                continue;
            }
            this._drawWire(WireDrawLayer._anchor(a), WireDrawLayer._anchor(b));
        }
        for (const [deviceId, poleId] of this._links) {
            const pole = this._poles.get(poleId);
            const device = this._objects.get(deviceId);
            if (pole === undefined || device === null) {
                continue;
            }
            this._drawWire(WireDrawLayer._anchor(pole), WireDrawLayer._anchor(device));
        }
        graphics.stroke({width: WIRE_WIDTH, color: WIRE_COLOR, alpha: WIRE_ALPHA});
    }

    /**
     * @private
     * @param {{x: number, y: number}} from
     * @param {{x: number, y: number}} to
     * @returns {void}
     */
    _drawWire(from, to) {
        this._drawWireInto(this._graphics, from, to);
    }

    /**
     * @private
     * @param {Graphics} graphics
     * @param {{x: number, y: number}} from
     * @param {{x: number, y: number}} to
     * @returns {void}
     */
    _drawWireInto(graphics, from, to) {
        // Screen-vertical separation is foreshortened ground distance, so the true span sets the
        // hang; the hang itself projects by the tilt (a steeper camera shows less of it).
        const span = Math.hypot(to.x - from.x, (to.y - from.y) / SAG_TILT);
        const sag = Math.min(SAG_MAX, span * SAG_FACTOR) * SAG_TILT;
        graphics.moveTo(from.x, from.y);
        graphics.quadraticCurveTo((from.x + to.x) / 2, (from.y + to.y) / 2 + sag, to.x, to.y);
    }

}
