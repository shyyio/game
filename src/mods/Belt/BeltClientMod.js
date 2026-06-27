
import {BeltMod} from "./mod.js";
import {BeltDrawLayer} from "./BeltLayer.js";
import {BeltItemDrawLayer} from "./BeltItemLayer.js";
import {BeltOverlayDrawLayer} from "./OverlayLayer.js";
import {BeltGhostLayer} from "./BeltGhostLayer.js";
import {PathDebugDrawLayer} from "./PathDebugLayer.js";
import {BeltTool} from "./BeltTool.js";
import {UndergroundBeltTool} from "./UndergroundBeltTool.js";
import {DeleteBeltMessage} from "./messages.js";
import {
    BeltInsertEvent,
    BeltSyncEvent,
    BeltUpdateEvent,
    BeltDeleteEvent,
    BeltPathRecalculateEvent,
} from "./events.js";
import {
    BeltType,
    ITEM_TYPE_GAP,
    BUFFERED_EVENT_TYPE_ITEM_UPSERT,
    BUFFERED_EVENT_TYPE_ITEM_DELETE,
    BUFFERED_EVENT_TYPE_ITEM_RESET,
} from "./constants.js";
import {surfaceBeltAt, walkTunnel} from "./geometry.js";
import {
    MiniMenuEntry,
    ViewportCache,
    ChunkUnsubscribeEvent,
    BufferedEvent,
    Direction,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
} from "@/sdk/client.js";

// Item sprites resting in out-ports share the item layer; their keys are namespaced
// from the path-item row-id keys so the two can't collide.
const PORT_SPRITE_KEY = portId => `port:${portId}`;

export class BeltClientMod extends BeltMod {

    constructor() {
        super();
        // One stable instance shared between drawLayers (which renders it) and
        // tools (which drive it via showGhost/clear).
        this._ghostLayer = new BeltGhostLayer();
        // The client's own picture of placed belts, kept current by onClientEvent
        // and queried by tools/menus — the browser never reads the simulation DB.
        this._beltCache = new ViewportCache();
        // Stable belt layer: onClientEvent drives it imperatively.
        this._beltLayer = new BeltDrawLayer();
        // Items riding the belts; driven imperatively from the tick's buffered events.
        this._itemLayer = new BeltItemDrawLayer();
        // Reveals buried tunnel belts under a hovered ramp; driven by onInspect.
        this._overlayLayer = new BeltOverlayDrawLayer();
        // Head id → belt ids in path order (head last); kept current by onClientEvent
        // and used to resolve an item's slot to a belt, plus drawn by the debug layer.
        this._pathParts = new Map();
        // Head id → Map<row id, {length, type}>: each path's RLE rows, synced and kept
        // current by item deltas. Item positions are derived from these, not sent.
        this._pathItems = new Map();
        // Out-port id → path head id, learned from path recalcs/chunk sync, so a
        // port-item event (which carries only the port id) resolves to a path and tile.
        this._outPortToPath = new Map();
        // Debug overlay of belt paths, shown only in debug mode; reads the shared
        // path map and belt cache.
        this._pathDebugLayer = new PathDebugDrawLayer(this._beltCache, this._pathParts);
    }

    get drawLayers() {
        return [this._beltLayer, this._itemLayer, this._overlayLayer, this._ghostLayer, this._pathDebugLayer];
    }

    tools(client) {
        // TODO: Filter to the tools available for the player (client.playerSettings).
        return [
            new BeltTool(client, this._beltCache, this._ghostLayer),
            new UndergroundBeltTool(client, this._beltCache, this._ghostLayer),
        ];
    }

    /**
     * Single client-side hub for belt events, keeping the belt cache and belt layer in lockstep.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onClientEvent(event, client) {
        if (event instanceof BeltInsertEvent || event instanceof BeltSyncEvent) {
            this._addBelt(event);
            // A live insert's path recalc is published before the belt itself, so the
            // overlay must repaint once the new belt is in the cache. Chunk syncs
            // already arrive before their recalcs, so they need no extra repaint.
            if (event instanceof BeltInsertEvent) {
                this._pathDebugLayer.redraw();
            }
            return;
        }
        if (event instanceof BeltUpdateEvent) {
            this._beltCache.update(event.id, {parentX: event.newParentX, parentY: event.newParentY});
            this._beltLayer.updateBelt(event.id, event.newParentX, event.newParentY);
            return;
        }
        if (event instanceof BeltPathRecalculateEvent) {
            this._updatePath(event.parts);
            if (event.outPortId !== null) {
                this._outPortToPath.set(event.outPortId, event.parts[event.parts.length - 1]);
            }
            this._pathDebugLayer.redraw();
            return;
        }
        if (event instanceof BeltDeleteEvent) {
            this._beltCache.remove(event.id);
            this._beltLayer.removeBelt(event.id);
            this._clearPathItems(event.id);
            if (this._pathParts.delete(event.id)) {
                this._pathDebugLayer.redraw();
            }
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            const removedIds = this._beltCache.clearChunk(event.chunk);
            const removed = new Set(removedIds);
            removedIds.forEach(id => {
                this._beltLayer.removeBelt(id);
                this._clearPathItems(id);
                this._pathParts.delete(id);
            });
            this._clearPortItems(removed);
            this._pathDebugLayer.redraw();
            return;
        }
        if (event instanceof BufferedEvent) {
            this._handleBufferedEvent(event);
        }
    }

    /**
     * Records a recalculated path under its head id, dropping any head a merge absorbed.
     * Items aren't touched here: an edit re-rows them, but the swap is done atomically
     * by the RESET + re-emitted UPSERT rows (same drain) so they never blink out.
     * @param {BigInt[]} parts - belt ids in path order, head last
     * @private
     */
    _updatePath(parts) {
        const head = parts[parts.length - 1];
        parts.forEach(id => {
            if (id !== head) {
                this._pathParts.delete(id);
            }
        });
        this._pathParts.set(head, parts);
    }

    /**
     * Routes a buffered event to the belt-item or out-port-item handler by type.
     * @param {BufferedEvent} event
     * @private
     */
    _handleBufferedEvent(event) {
        if (event.type === BUFFERED_EVENT_TYPE_PORT_ITEM_SET
            || event.type === BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR) {
            this._handlePortItemEvent(event);
            return;
        }
        this._handleItemEvent(event);
    }

    /**
     * Renders or removes an item resting in an out-port. The event carries only the
     * port id; the render tile is inferred from the out-port's path and tail belt.
     * @param {BufferedEvent} event - id=out-port id, a=item type (SET only)
     * @private
     */
    _handlePortItemEvent(event) {
        const portId = event.id;
        if (event.type === BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR) {
            this._itemLayer.removeItem(PORT_SPRITE_KEY(portId));
            return;
        }
        this._renderPortItem(portId);
    }

    /**
     * Places an out-port's item sprite at the belt's output boundary (the tile
     * downstream of the tail, on its upstream edge — where the item just popped off).
     * @param {BigInt} portId
     * @private
     */
    _renderPortItem(portId) {
        const belt = this._resolvePortBelt(portId);
        if (belt === null) {
            return;
        }
        this._itemLayer.moveItem(PORT_SPRITE_KEY(portId), belt.tileX, belt.tileY, true, belt.sourceDir);
    }

    /**
     * The tile an out-port's item rests on: one downstream of the path's tail (output)
     * belt, with sourceDir pointing back at the tail (the edge it popped off). Returns
     * null when the path or belt isn't cached yet.
     * @param {BigInt} portId
     * @returns {{tileX: number, tileY: number, sourceDir: Direction}|null}
     * @private
     */
    _resolvePortBelt(portId) {
        const head = this._outPortToPath.get(portId);
        if (head === undefined) {
            return null;
        }
        const parts = this._pathParts.get(head);
        if (parts === undefined) {
            return null;
        }
        const tail = this._beltCache.get(parts[0]);
        if (tail === null) {
            return null;
        }
        const direction = tail.data.direction;
        return {
            tileX: tail.tileX + Direction.dx(direction),
            tileY: tail.tileY + Direction.dy(direction),
            sourceDir: Direction.invert(direction),
        };
    }

    /**
     * Drops out-port item sprites whose path head left the viewport.
     * @param {Set<BigInt>} removedHeads
     * @private
     */
    _clearPortItems(removedHeads) {
        this._outPortToPath.forEach((head, portId) => {
            if (removedHeads.has(head)) {
                this._itemLayer.removeItem(PORT_SPRITE_KEY(portId));
                this._outPortToPath.delete(portId);
            }
        });
    }

    /**
     * Applies one item delta: UPSERT inserts-or-resizes a row, DELETE drops one. Either
     * way the path's items are repositioned, since one row change shifts the whole path.
     * @param {BufferedEvent} event - id=path, a=row id, b=length, c=type
     * @private
     */
    _handleItemEvent(event) {
        const pathId = event.id;
        if (event.type === BUFFERED_EVENT_TYPE_ITEM_RESET) {
            this._resetPathItems(pathId);
            return;
        }
        const rowId = event.a;
        if (event.type === BUFFERED_EVENT_TYPE_ITEM_DELETE) {
            const rows = this._pathItems.get(pathId);
            if (rows !== undefined) {
                rows.delete(rowId);
            }
            this._itemLayer.removeItem(rowId);
            this._recomputePathItems(pathId);
            return;
        }
        if (event.type !== BUFFERED_EVENT_TYPE_ITEM_UPSERT) {
            return;
        }
        let rows = this._pathItems.get(pathId);
        if (rows === undefined) {
            rows = new Map();
            this._pathItems.set(pathId, rows);
        }
        rows.set(rowId, {length: Number(event.b), type: Number(event.c)});
        this._recomputePathItems(pathId);
    }

    /**
     * Clears the item sprites/rows of a path about to be re-synced, under every belt in
     * it — the head and any former heads a merge folded in — so no stale sprite survives
     * the re-keyed rebuild. The following re-emitted UPSERT rows (same drain) repopulate it.
     * @param {BigInt} pathId
     * @private
     */
    _resetPathItems(pathId) {
        const parts = this._pathParts.get(pathId);
        if (parts === undefined) {
            this._clearPathItems(pathId);
            return;
        }
        parts.forEach(id => this._clearPathItems(id));
    }

    /**
     * Repositions every item on a path from its RLE rows. Rows lie output-to-input in
     * ascending id order; walking input-to-output (descending id) and accumulating
     * lengths gives each row's slot = head_gap + lengths nearer the input, where
     * head_gap = path length − Σ row lengths.
     * @param {BigInt} pathId
     * @private
     */
    _recomputePathItems(pathId) {
        const parts = this._pathParts.get(pathId);
        const rows = this._pathItems.get(pathId);
        if (parts === undefined || rows === undefined) {
            return;
        }
        const pathLength = 2 * parts.length - 1;
        let total = 0;
        rows.forEach(row => {
            total += row.length;
        });
        let slot = pathLength - total;
        const rowIds = Array.from(rows.keys()).sort((a, b) => (a < b ? 1 : -1));
        rowIds.forEach(rowId => {
            const row = rows.get(rowId);
            if (row.type !== ITEM_TYPE_GAP) {
                const belt = this._resolveItemBelt(pathId, slot);
                if (belt !== null) {
                    this._itemLayer.moveItem(rowId, belt.tileX, belt.tileY, belt.halfTile, belt.sourceDir);
                }
            }
            slot += row.length;
        });
    }

    /**
     * Drops a path's item sprites and tracked rows (head removed, or about to be re-synced).
     * @param {BigInt} pathId
     * @private
     */
    _clearPathItems(pathId) {
        const rows = this._pathItems.get(pathId);
        if (rows === undefined) {
            return;
        }
        rows.forEach((row, rowId) => {
            this._itemLayer.removeItem(rowId);
        });
        this._pathItems.delete(pathId);
    }

    /**
     * Maps an item's path and slot to the belt it sits on. slot counts half-tiles
     * from the input (head); each belt past the head owns a full then a half slot, so
     * the belt is parts[(N-1) - floor((slot+1)/2)] and an odd slot is the half-tile
     * straddle. sourceDir points at the belt feeding this one (the bend's input edge).
     * Returns null when the path or belt isn't cached yet.
     * @param {BigInt} pathId
     * @param {number} slot
     * @returns {{tileX: number, tileY: number, sourceDir: Direction, halfTile: boolean}|null}
     * @private
     */
    _resolveItemBelt(pathId, slot) {
        const parts = this._pathParts.get(pathId);
        if (parts === undefined) {
            return null;
        }
        const beltIndex = (parts.length - 1) - Math.floor((slot + 1) / 2);
        if (beltIndex < 0 || beltIndex >= parts.length) {
            return null;
        }
        const record = this._beltCache.get(parts[beltIndex]);
        if (record === null) {
            return null;
        }
        return {
            tileX: record.tileX,
            tileY: record.tileY,
            sourceDir: this._sourceDirection(record),
            halfTile: slot % 2 === 1,
        };
    }

    /**
     * The direction toward the belt feeding `record` — the side an item enters from
     * (perpendicular to the flow on a bend). Falls back to opposite the flow for a head
     * belt (fed by its in-port) or one whose parent isn't cached.
     * @param {object} record - belt cache record
     * @returns {Direction}
     * @private
     */
    _sourceDirection(record) {
        const {direction, parentX, parentY} = record.data;
        if (parentX !== null && parentY !== null) {
            return Direction.fromDelta(Math.sign(parentX - record.tileX), Math.sign(parentY - record.tileY));
        }
        return Direction.invert(direction);
    }

    /**
     * Adds a belt to the viewport cache and the draw layer (shared by inserts and syncs).
     * @param {BeltInsertEvent|BeltSyncEvent} event
     * @private
     */
    _addBelt(event) {
        this._beltCache.insert(event.id, event.x, event.y, {
            direction: event.direction,
            type: event.beltType,
            parentX: event.parentX,
            parentY: event.parentY,
        });
        this._beltLayer.addBelt(event.id, event.x, event.y, event.direction, event.beltType, event.parentX, event.parentY);
    }

    /**
     * Tool-less hover: reveal the buried tunnel under a hovered ramp and return the tiles to highlight.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {{x: number, y: number, alt?: boolean}[]}
     */
    onInspect(tileX, tileY) {
        if (tileX === null) {
            this._overlayLayer.clearUndergroundReveal();
            return [];
        }
        const records = this._beltCache.getAtTile(tileX, tileY);
        const surface = surfaceBeltAt(this._beltCache, tileX, tileY);
        const ramp = records.find(record =>
            record.data.type === BeltType.RAMP_DOWN || record.data.type === BeltType.RAMP_UP);
        const tunnel = ramp === undefined ? null : walkTunnel(this._beltCache, ramp);

        // Highlight the hovered surface belt/ramp (buried undergrounds aren't drawn),
        // plus the ramp it tunnels to (if any) with the alternate highlight.
        const inspectTiles = [];
        if (surface !== null) {
            inspectTiles.push({x: tileX, y: tileY});
        }
        if (tunnel !== null && tunnel.pair !== null) {
            inspectTiles.push({x: tunnel.pair.tileX, y: tunnel.pair.tileY, alt: true});
        }

        if (tunnel === null) {
            this._overlayLayer.clearUndergroundReveal();
        } else {
            this._overlayLayer.showUndergroundReveal(tunnel.tiles, ramp.data.direction);
        }
        return inspectTiles;
    }

    miniMenuContextEntries(tileX, tileY, session) {
        const surface = surfaceBeltAt(this._beltCache, tileX, tileY);

        if (surface === null) {
            return [];
        }

        return [
            new MiniMenuEntry(
                "Delete belt",
                10,
                () => session.sendMessage(new DeleteBeltMessage(surface.id)),
            ),
        ];
    }

}
