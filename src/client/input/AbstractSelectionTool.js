import {AbstractTool} from "@/client/input/AbstractTool.js";
import {NotImplementedError} from "@/common/error.js";
import {getCopyableEntriesInRect} from "@/client/input/copySelection.js";
import Mouse from "@/client/input/Mouse.js";
import Haptics from "@/client/Haptics.js";
import {TILE_SIZE} from "@/client/constants.js";
import {TARGET_TILE_COLOR} from "@/client/Theme.js";
import {MAX_BLUEPRINT_ENTRIES} from "@/common/CoreMessages.js";
import {SelectionPreviewEntry} from "@/client/state/ToolPreviewCache.js";

const MARQUEE_COLOR = 0xFFFFFF;

/**
 * Marquee selection into the blueprint history: a drag, or two taps, spans a rectangle between two world
 * points, and the first `MAX_BLUEPRINT_ENTRIES` selectable objects with a cell under it, in the
 * order they were placed, are handed to the subclass. The paste tool takes over once a selection is taken.
 */
export class AbstractSelectionTool extends AbstractTool {

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

    get textureName() {
        // Placeholder
        return "inspect/1x1";
    }

    /**
     * The status line before the first corner is set.
     * @abstract
     * @returns {string}
     */
    get promptText() {
        throw new NotImplementedError();
    }

    /**
     * The feedback when the rectangle takes nothing.
     * @abstract
     * @returns {string}
     */
    get emptySelectionText() {
        throw new NotImplementedError();
    }

    /**
     * The rectangle's color.
     * @returns {number}
     */
    get marqueeColor() {
        return MARQUEE_COLOR;
    }

    /**
     * The color the objects the rectangle takes are marked in.
     * @returns {number}
     */
    get selectionColor() {
        return TARGET_TILE_COLOR;
    }

    get statusText() {
        if (this._startX === null) {
            return this.promptText;
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
        this._select(aim.x, aim.y);
    }

    onDragStart(tileX, tileY) {
        this._start(Mouse.pressX, Mouse.pressY);
    }

    onDragTile(tileX, tileY, direction) {}

    onDragEnd(tileX, tileY) {
        const aim = Mouse.aimPoint();
        this._select(aim.x, aim.y);
    }

    onDeactivate() {
        this._reset();
    }

    /**
     * Whether a copyable object under the rectangle may be taken.
     * @param {CacheEntry} entry
     * @returns {boolean}
     */
    isSelectable(entry) {
        return true;
    }

    /**
     * The entries the rectangle takes, in placement order.
     * @param {ObjectsView} objects
     * @param {number} fromX
     * @param {number} fromY
     * @param {number} toX
     * @param {number} toY
     * @returns {CacheEntry[]}
     */
    collectSelection(objects, fromX, fromY, toX, toY) {
        const selected = [];
        for (const entry of getCopyableEntriesInRect(objects, fromX, fromY, toX, toY)) {
            if (selected.length === MAX_BLUEPRINT_ENTRIES) {
                break;
            }
            if (this.isSelectable(entry)) {
                selected.push(entry);
            }
        }
        return selected;
    }

    /**
     * Takes a non-empty selection into the blueprint history.
     * @abstract
     * @param {CacheEntry[]} selected in placement order
     * @returns {void}
     */
    applySelection(selected) {
        throw new NotImplementedError();
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
        this._marqueeLayer.start(x, y, this);
        this._client.toolPreview.setSelection(new SelectionPreviewEntry(x / TILE_SIZE, y / TILE_SIZE, this.id));
    }

    /**
     * Takes the rectangle from the start point to (x, y) and hands over to the paste tool.
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    _select(x, y) {
        const selected = this.collectSelection(this._client.objects, this._startX, this._startY, x, y);
        this._reset();
        if (selected.length === 0) {
            this._client.drawPlacementBlockedReason(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE), this.emptySelectionText);
            return;
        }
        this.applySelection(selected);
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
        this._client.toolPreview.setSelection(null);
        this.notifyStatusChange();
    }
}
