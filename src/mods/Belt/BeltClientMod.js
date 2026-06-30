
import {BeltMod} from "./mod.js";
import {BeltDrawLayer} from "./BeltLayer.js";
import {BeltOverlayDrawLayer} from "./OverlayLayer.js";
import {BeltGhostLayer} from "./BeltGhostLayer.js";
import {PathDebugDrawLayer} from "./PathDebugLayer.js";
import {BeltTool} from "./BeltTool.js";
import {UndergroundBeltTool} from "./UndergroundBeltTool.js";
import {BeltDefinition, SplitterDefinition} from "./definitions.js";
import {
    BeltInsertEvent,
    BeltSyncEvent,
    BeltDeleteEvent,
    BeltPathRecalculateEvent,
} from "./events.js";
import {
    BeltType,
    ITEM_TYPE_GAP,
    BUFFERED_EVENT_TYPE_ITEM_UPSERT,
    BUFFERED_EVENT_TYPE_ITEM_DELETE,
    BUFFERED_EVENT_TYPE_ITEM_RESET,
    BUFFERED_EVENT_TYPE_ITEM_SYNC,
} from "./constants.js";
import {surfaceBeltAt, walkTunnel, beltOccupancyLayer, inferBeltParent} from "./geometry.js";
import {
    MiniMenuEntry,
    ChunkUnsubscribeEvent,
    BufferedEvent,
    Direction,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
    DeleteObjectMessage,
    PORT_SPRITE_KEY,
    EasyObjectTool,
    EasyObjectGhostLayer,
    EasyObjectDrawLayer,
    InspectHighlight,
} from "@/sdk/client.js";

export class BeltClientMod extends BeltMod {

    constructor() {
        super();
        // One stable instance shared between drawLayers (which renders it) and
        // tools (which drive it via showGhost/clear).
        this._ghostLayer = new BeltGhostLayer();
        // The shared cross-mod object index, captured on the first client hook; the mod registers
        // its belts and splitters into it and queries it instead of the simulation DB.
        this._cache = null;
        // Stable belt layer: onClientEvent drives it imperatively.
        this._beltLayer = new BeltDrawLayer();
        // The shared item layer, captured on the first client hook; belts drive their items imperatively.
        this._itemLayer = null;
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
        // The inverse, path head id → out-port id, so a lead item's DELETE (a pop) can
        // hand its sprite to the out-port it popped into.
        this._pathToOutPort = new Map();
        // Debug overlay of belt paths, shown only in debug mode; reads the shared
        // path map and the object index (injected).
        this._pathDebugLayer = new PathDebugDrawLayer(this._pathParts);
        // Splitter sprites; the layer drives its own cache + sprite lifecycle off the object events.
        this._splitterLayer = new EasyObjectDrawLayer(SplitterDefinition);
        // Splitter placement preview, driven by the splitter tool via showGhost/clear.
        this._splitterGhostLayer = new EasyObjectGhostLayer(SplitterDefinition);
    }

    get drawLayers() {
        return [
            this._beltLayer,
            this._splitterLayer,
            this._overlayLayer,
            this._ghostLayer,
            this._splitterGhostLayer,
            this._pathDebugLayer,
        ];
    }

    get itemTextures() {
        return {3: "items/1"};
    }

    /**
     * Captures the shared object index and item layer on the first client hook, for the imperative
     * event handlers that aren't passed `client`.
     * @param {Client} client
     * @returns {void}
     */
    _useClient(client) {
        if (this._cache === null) {
            this._cache = client.cache;
            this._itemLayer = client.itemLayer;
        }
    }

    tools(client) {
        // TODO: Filter to the tools available for the player (client.playerSettings).
        return [
            new BeltTool(client, this._ghostLayer),
            new UndergroundBeltTool(client, this._ghostLayer),
            new EasyObjectTool(client, SplitterDefinition, this._splitterGhostLayer, false),
        ];
    }

    /**
     * Single client-side hub for belt events, keeping the belt cache and belt layer in lockstep.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onClientEvent(event, client) {
        this._useClient(client);
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
        if (event instanceof BeltPathRecalculateEvent) {
            this._updatePath(event.parts);
            if (event.outPortId !== null) {
                const head = event.parts[event.parts.length - 1];
                this._outPortToPath.set(event.outPortId, head);
                this._pathToOutPort.set(head, event.outPortId);
            }
            this._pathDebugLayer.redraw();
            return;
        }
        if (event instanceof BeltDeleteEvent) {
            this._cache.remove(event.id);
            this._beltLayer.removeBelt(event.id);
            this._clearPathItems(event.id);
            this._clearOutPortItemAt(event.id);
            if (this._pathParts.delete(event.id)) {
                this._pathDebugLayer.redraw();
            }
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            // Drop only this mod's own belts — the splitter layer drops its own, and other mods
            // theirs.
            const removedBelts = new Set();
            this._cache.getByChunk(event.chunk).forEach(record => {
                if (record.data.definition === BeltDefinition) {
                    removedBelts.add(record.id);
                    this._beltLayer.removeBelt(record.id);
                    this._clearPathItems(record.id);
                    this._pathParts.delete(record.id);
                    this._cache.remove(record.id);
                }
            });
            this._clearPortItems(removedBelts);
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
     * Renders or removes an item resting in a belt path's out-port (the render tile is computed
     * from the path's tail belt). Splitter out-ports are static, so the engine renders those —
     * skip any port this mod doesn't own a path for.
     * @param {BufferedEvent} event - id=out-port id, a=item type (SET only)
     * @private
     */
    _handlePortItemEvent(event) {
        const portId = event.id;
        if (!this._outPortToPath.has(portId)) {
            return;
        }
        if (event.type === BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR) {
            this._itemLayer.removeItem(PORT_SPRITE_KEY(portId));
            return;
        }
        this._renderPortItem(portId, Number(event.a));
    }

    /**
     * Places a belt path out-port's item sprite at its output boundary: the tile downstream of
     * the tail, on the upstream edge where the item just popped off.
     * @param {BigInt} portId
     * @param {number} type - item type, selecting the sprite texture
     * @private
     */
    _renderPortItem(portId, type) {
        const port = this._resolvePortBelt(portId);
        if (port === null) {
            return;
        }
        this._itemLayer.moveItem(PORT_SPRITE_KEY(portId), port.tileX, port.tileY, true, port.sourceDir, type);
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
        const tail = this._cache.get(parts[0]);
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
                this._pathToOutPort.delete(head);
            }
        });
    }

    /**
     * Drops the resting out-port item when the path's output belt (parts[0], where that
     * item renders) is the one being deleted: its port item is destroyed server-side, so
     * clear the sprite now instead of waiting for the next tick's PORT_ITEM_CLEAR. Deleting
     * the input/head belt instead leaves the output item in place, so it is untouched.
     * Forgets the port mapping only when the head itself goes (the whole path is gone).
     * @param {BigInt} deletedBelt
     * @private
     */
    _clearOutPortItemAt(deletedBelt) {
        this._pathToOutPort.forEach((portId, head) => {
            const parts = this._pathParts.get(head);
            if (parts === undefined || parts[0] !== deletedBelt) {
                return;
            }
            this._itemLayer.removeItem(PORT_SPRITE_KEY(portId));
            if (head === deletedBelt) {
                this._outPortToPath.delete(portId);
                this._pathToOutPort.delete(head);
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
            const row = rows === undefined ? undefined : rows.get(rowId);
            this._dropDeletedItem(pathId, rowId, row);
            if (rows !== undefined) {
                rows.delete(rowId);
            }
            this._recomputePathItems(pathId);
            return;
        }
        const sync = event.type === BUFFERED_EVENT_TYPE_ITEM_SYNC;
        if (event.type !== BUFFERED_EVENT_TYPE_ITEM_UPSERT && !sync) {
            return;
        }
        let rows = this._pathItems.get(pathId);
        if (rows === undefined) {
            rows = new Map();
            this._pathItems.set(pathId, rows);
        }
        rows.set(rowId, {length: Number(event.b), type: Number(event.c)});
        // A SYNC row was only re-keyed, not moved, so place its sprite without animating.
        this._recomputePathItems(pathId, sync);
    }

    /**
     * Disposes a deleted item's sprite. A non-gap delete on a path with an out-port is a
     * pop (edits re-sync via RESET, not DELETE): hand the sprite to the out-port so it
     * glides the last stretch in — replacing the previous occupant, which the downstream
     * path's freshly-ingested item already covers — instead of vanishing while the
     * same-type (so un-refreshed) port sprite sits still. Anything else is just removed.
     * @param {BigInt} pathId
     * @param {BigInt} rowId
     * @param {{length: number, type: number}|undefined} row - the item's RLE row, if tracked
     * @private
     */
    _dropDeletedItem(pathId, rowId, row) {
        const outPortId = this._pathToOutPort.get(pathId);
        if (row === undefined || row.type === ITEM_TYPE_GAP || outPortId === undefined) {
            this._itemLayer.removeItem(rowId);
            return;
        }
        this._itemLayer.renameItem(rowId, PORT_SPRITE_KEY(outPortId));
        this._renderPortItem(outPortId, row.type);
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
     * @param {boolean} [snap] - place sprites without animating (a re-sync, not a move)
     * @private
     */
    _recomputePathItems(pathId, snap=false) {
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
                    this._itemLayer.moveItem(rowId, belt.tileX, belt.tileY, belt.halfTile, belt.sourceDir, row.type, snap);
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
        const record = this._cache.get(parts[beltIndex]);
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
     * The direction toward the object feeding `record` — the side an item enters from
     * (perpendicular to the flow on a bend), inferred from the cache. Falls back to opposite
     * the flow for a head belt (fed by its in-port) or one with no cached feeder.
     * @param {CacheEntry} record - belt cache entry
     * @returns {Direction}
     * @private
     */
    _sourceDirection(record) {
        const {parentX, parentY} = inferBeltParent(this._cache, record.tileX, record.tileY, record.data.direction);
        if (parentX !== null && parentY !== null) {
            return Direction.fromDelta(Math.sign(parentX - record.tileX), Math.sign(parentY - record.tileY));
        }
        return Direction.invert(record.data.direction);
    }

    /**
     * Adds a belt to the viewport cache and the draw layer (shared by inserts and syncs).
     * @param {BeltInsertEvent|BeltSyncEvent} event
     * @private
     */
    _addBelt(event) {
        this._cache.set(
            event.id,
            event.x,
            event.y,
            [{x: event.x, y: event.y, layer: beltOccupancyLayer(event.beltType, event.direction)}],
            {},
            // `conveyor` is a generic cache convention: a straight surface lane an aligned
            // placement (a splitter, a machine) may overwrite. Other mods read it without
            // knowing belt types.
            {
                definition: BeltDefinition,
                direction: event.direction,
                type: event.beltType,
                conveyor: event.beltType === BeltType.NORMAL,
            },
        );
        // Bend is derived from neighbours each frame by the belt layer, so it's added straight.
        this._beltLayer.addBelt(event.id, event.x, event.y, event.direction, event.beltType);
    }

    /**
     * Tool-less hover: reveal the buried tunnel under a hovered ramp and return the tiles to highlight.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     * @returns {{x: number, y: number, alt?: boolean}[]}
     */
    onInspect(tileX, tileY, client) {
        if (tileX === null) {
            this._overlayLayer.clearUndergroundReveal();
            return [];
        }
        this._useClient(client);
        const records = this._cache.getAtTile(tileX, tileY);
        const surface = surfaceBeltAt(this._cache, tileX, tileY);
        const ramp = records.find(record =>
            record.data.type === BeltType.RAMP_DOWN || record.data.type === BeltType.RAMP_UP);
        const tunnel = ramp === undefined ? null : walkTunnel(this._cache, ramp);

        // Highlight the hovered surface belt/ramp (buried undergrounds aren't drawn),
        // plus the ramp it tunnels to (if any) with the alternate highlight.
        const highlights = [];
        if (surface !== null) {
            highlights.push(new InspectHighlight(tileX, tileY, surface.data.direction, surface.data.definition));
        }
        if (tunnel !== null && tunnel.pair !== null) {
            highlights.push(new InspectHighlight(tunnel.pair.tileX, tunnel.pair.tileY, tunnel.pair.data.direction, tunnel.pair.data.definition, true));
        }

        if (tunnel === null) {
            this._overlayLayer.clearUndergroundReveal();
        } else {
            this._overlayLayer.showUndergroundReveal(tunnel.tiles, ramp.data.direction);
        }

        const splitter = this._cache.objectAt(tileX, tileY, SplitterDefinition);
        if (splitter !== null) {
            highlights.push(new InspectHighlight(splitter.tileX, splitter.tileY, splitter.data.direction, splitter.data.definition));
        }
        return highlights;
    }

    miniMenuEntries(tileX, tileY, session, client) {
        this._useClient(client);
        const surface = surfaceBeltAt(this._cache, tileX, tileY);

        if (surface === null) {
            return [];
        }

        return [
            new MiniMenuEntry(
                "Delete belt",
                10,
                () => session.sendMessage(new DeleteObjectMessage(surface.id)),
            ),
        ];
    }

}
