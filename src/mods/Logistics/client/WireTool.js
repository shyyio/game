import {AbstractTool, Haptics, LAYER_SURFACE} from "@spup/sdk/client";
import {withinPoleRange} from "../common/constants.js";
import {isPoleType} from "../common/objectTypes.js";
import {WireLinkMessage, WireUnlinkMessage} from "../common/messages.js";

/**
 * Two-click wiring, toggle semantics: tap an endpoint (pole or wireable device), then tap a
 * second endpoint — an existing wire between them is removed, otherwise one is added. At least
 * one endpoint must be a pole. Tapping the selection again or empty ground clears it.
 */
export class WireTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {WireDrawLayer} wireLayer
     */
    constructor(client, wireLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.objects;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._wireLayer = wireLayer;
        this._selectedId = null;
    }

    get label() {
        return "Wire";
    }

    get id() {
        return 31;
    }

    get textureName() {
        return "wire/0";
    }

    get statusText() {
        if (this._selectedId === null) {
            return "Wire: select a pole or device";
        }
        return "Wire: select the other end";
    }

    onTap(tileX, tileY) {
        const entry = this._cache.at(tileX, tileY, LAYER_SURFACE);
        if (entry === null || (!isPoleType(entry.data.type) && !WireTool._wireableDevice(entry))) {
            this._select(null);
            return;
        }
        if (entry.id === this._selectedId) {
            this._select(null);
            return;
        }
        if (this._selectedId === null) {
            this._select(entry.id);
            return;
        }
        const selected = this._cache.get(this._selectedId);
        if (selected === null || !WireTool._pairable(selected, entry)) {
            this._select(entry.id);
            return;
        }
        if (!this._inRange(selected, entry)) {
            return;
        }
        if (this._hasWire(selected, entry)) {
            this.session.sendMessage(new WireUnlinkMessage(selected.id, entry.id));
        } else {
            this.session.sendMessage(new WireLinkMessage(selected.id, entry.id));
        }
        Haptics.tap();
        this._select(null);
    }

    onDragStart(tileX, tileY) {
    }

    /**
     * No-op: wires place by tap only.
     * @returns {void}
     */
    onDragTile(tileX, tileY, direction) {
    }

    onTileEnter(tileX, tileY) {
        this._showPreview(tileX, tileY);
        const entry = this._cache.at(tileX, tileY, LAYER_SURFACE);
        const tile = [{x: tileX, y: tileY}];
        if (entry === null) {
            this._placementFeedbackLayer.show({blocked: [], overwrite: [], clear: [], showTarget: true});
            return;
        }
        if (this._actionable(entry)) {
            this._placementFeedbackLayer.show({blocked: [], overwrite: [], clear: tile, showTarget: true});
        } else {
            this._placementFeedbackLayer.show({blocked: tile, overwrite: [], clear: [], showTarget: true});
        }
    }

    onTileExit(tileX, tileY) {
        this._placementFeedbackLayer.clear();
    }

    onDeactivate() {
        this._select(null);
        this._placementFeedbackLayer.clear();
    }

    /**
     * Whether the entry is a device the network accepts.
     * @private
     * @param {CacheEntry} entry
     * @returns {boolean}
     */
    static _wireableDevice(entry) {
        return entry.data.type.wireAnchor !== null;
    }

    /**
     * Whether two endpoints can carry a wire: at least one must be a pole.
     * @private
     * @param {CacheEntry} a
     * @param {CacheEntry} b
     * @returns {boolean}
     */
    static _pairable(a, b) {
        return isPoleType(a.data.type) || isPoleType(b.data.type);
    }

    /**
     * @private
     * @param {CacheEntry} a
     * @param {CacheEntry} b
     * @returns {boolean}
     */
    _inRange(a, b) {
        return withinPoleRange(a.tileX, a.tileY, b.tileX, b.tileY);
    }

    /**
     * Whether a wire already runs between the endpoints, off the synced client state.
     * @private
     * @param {CacheEntry} a
     * @param {CacheEntry} b
     * @returns {boolean}
     */
    _hasWire(a, b) {
        if (isPoleType(a.data.type) && isPoleType(b.data.type)) {
            return this._wireLayer.hasEdge(a.id, b.id);
        }
        const device = isPoleType(a.data.type) ? b : a;
        const pole = isPoleType(a.data.type) ? a : b;
        return this._client.cache.mapGet("logistics.linkPoleById", device.id) === pole.id;
    }

    /**
     * @private
     * @param {number|null} id
     * @returns {void}
     */
    _select(id) {
        this._selectedId = id;
        if (id === null) {
            this._wireLayer.clearPreview();
            return;
        }
        Haptics.tap();
        const selected = this._cache.get(id);
        if (selected !== null) {
            this._wireLayer.showPreview(selected, null);
        }
    }

    /**
     * Points the in-progress wire at the hovered endpoint, or lets it follow the pointer.
     * @private
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    _showPreview(tileX, tileY) {
        if (this._selectedId === null) {
            return;
        }
        const selected = this._cache.get(this._selectedId);
        if (selected === null) {
            this._select(null);
            return;
        }
        const entry = this._cache.at(tileX, tileY, LAYER_SURFACE);
        let snap = null;
        if (entry !== null && entry.id !== selected.id
            && (isPoleType(entry.data.type) || WireTool._wireableDevice(entry))
            && WireTool._pairable(selected, entry)) {
            snap = entry;
        }
        this._wireLayer.showPreview(selected, snap);
    }

    /**
     * Whether tapping the entry advances the flow: an endpoint always selects; with a selection,
     * a pairable partner must also be in range.
     * @private
     * @param {CacheEntry} entry
     * @returns {boolean}
     */
    _actionable(entry) {
        if (!isPoleType(entry.data.type) && !WireTool._wireableDevice(entry)) {
            return false;
        }
        if (this._selectedId === null || entry.id === this._selectedId) {
            return true;
        }
        const selected = this._cache.get(this._selectedId);
        if (selected === null || !WireTool._pairable(selected, entry)) {
            return true;
        }
        return this._inRange(selected, entry);
    }
}
