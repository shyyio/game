import {AbstractTool} from "@/client/input/AbstractTool.js";
import {KEYBINDING_COPY} from "@/common/KeybindingEntry.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {getCopyableEntriesInRect} from "@/client/input/copySelection.js";
import Mouse from "@/client/input/Mouse.js";
import Haptics from "@/client/Haptics.js";
import {TILE_SIZE} from "@/client/constants.js";

const NOTHING_TO_COPY = "Nothing to copy";

/**
 * Marquee selection into the clipboard: a drag, or two taps, spans a rectangle between two world
 * points, and every copyable object with a cell under it goes into a Blueprint in the order it was
 * placed. The paste tool takes over on a copy.
 */
export class CopyTool extends AbstractTool {

    /**
     * @param {Client} client
     */
    constructor(client) {
        super(client.session);
        this._client = client;
        this._marqueeLayer = client.marqueeLayer;
        // The first corner in world px, once a drag started or a tap set it.
        this._startX = null;
        this._startY = null;
    }

    get label() {
        return "Copy";
    }

    get id() {
        return 40;
    }

    get keybinding() {
        return KEYBINDING_COPY;
    }

    get textureName() {
        // Placeholder
        return "inspect/1x1";
    }

    get statusText() {
        if (this._startX === null) {
            return "Drag over the objects to copy";
        }
        return "Tap the opposite corner";
    }

    onTap(tileX, tileY) {
        const aim = Mouse.aimPoint();
        if (this._startX === null) {
            this._start(aim.x, aim.y);
            this.notifyStatusChange();
            return;
        }
        this._copy(aim.x, aim.y);
    }

    onDragStart(tileX, tileY) {
        this._start(Mouse.pressX, Mouse.pressY);
    }

    onDragTile(tileX, tileY, direction) {}

    onDragEnd(tileX, tileY) {
        const aim = Mouse.aimPoint();
        this._copy(aim.x, aim.y);
    }

    onDeactivate() {
        this._reset();
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    _start(x, y) {
        this._startX = x;
        this._startY = y;
        this._marqueeLayer.start(x, y);
    }

    /**
     * Copies the rectangle from the start point to (x, y) and hands the paste tool the clipboard.
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    _copy(x, y) {
        const selected = getCopyableEntriesInRect(this._client.objects, this._startX, this._startY, x, y);
        this._reset();
        if (selected.length === 0) {
            this._client.drawPlacementBlockedReason(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE), NOTHING_TO_COPY);
            return;
        }
        this._client.clipboard = new Blueprint(buildEntries(selected));
        Haptics.tap();
        this._client.hud.toolbarLayer.setActiveTool(this._client.blueprintTool);
    }

    /**
     * @private
     * @returns {void}
     */
    _reset() {
        this._startX = null;
        this._startY = null;
        this._marqueeLayer.clear();
        this.notifyStatusChange();
    }
}

/**
 * The selection as blueprint entries, relative to its top-left object cell.
 * @param {CacheEntry[]} selected in placement order
 * @returns {BlueprintEntry[]}
 */
function buildEntries(selected) {
    let anchorTileX = Infinity;
    let anchorTileY = Infinity;
    for (const entry of selected) {
        const bounds = entry.tileBounds;
        anchorTileX = Math.min(anchorTileX, bounds.minTileX);
        anchorTileY = Math.min(anchorTileY, bounds.minTileY);
    }
    return selected.map(entry => new BlueprintEntry(
        entry.data.type.objectTypeId,
        entry.tileX - anchorTileX,
        entry.tileY - anchorTileY,
        entry.data.direction,
    ));
}
