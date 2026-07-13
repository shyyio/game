
import {LogisticsMod} from "./mod.js";
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
    BeltItemUpsertEvent,
    BeltItemSyncEvent,
    BeltItemDeleteEvent,
    BeltItemResetEvent,
} from "./events.js";
import {
    BeltType,
    ITEM_TYPE_GAP,
} from "./constants.js";
import {surfaceBeltAt, walkTunnel, tunnelStep, isRamp, beltOccupancyLayer, inferBeltParent} from "./geometry.js";
import {
    MiniMenuEntry,
    ChunkUnsubscribeEvent,
    PortItemSetEvent,
    PortItemClearEvent,
    Direction,
    DeleteObjectMessage,
    PORT_SPRITE_KEY,
    EasyObjectTool,
    EasyObjectGhostLayer,
    EasyObjectDrawLayer,
    InspectHighlight,
    Rectangle,
    TILE_SIZE,
} from "@/sdk/client.js";

export class LogisticsClientMod extends LogisticsMod {

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
        // Head id → Map<run id, {length, type}>: each path's RLE runs, synced and kept
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
            const record = this._cache.get(event.id);
            if (record !== null && isRamp(record.data.type)) {
                this._removeRampMasks(event.id);
            }
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
                    if (isRamp(record.data.type)) {
                        this._removeRampMasks(record.id);
                    }
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
        if (event instanceof PortItemSetEvent || event instanceof PortItemClearEvent) {
            this._handlePortItemEvent(event);
            return;
        }
        if (event instanceof BeltItemUpsertEvent
            || event instanceof BeltItemSyncEvent
            || event instanceof BeltItemDeleteEvent
            || event instanceof BeltItemResetEvent) {
            this._handleItemEvent(event);
        }
    }

    /**
     * Records a recalculated path under its head id, dropping any head a merge absorbed.
     * Items aren't touched here: an edit re-keys them, but the swap is done atomically
     * by the RESET + re-emitted UPSERT runs (same drain) so they never blink out.
     * @param {number[]} parts - belt ids in path order, head last
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
     * Renders or removes an item resting in a belt path's out-port (the render tile is computed
     * from the path's tail belt). Splitter out-ports are static, so the engine renders those —
     * skip any port this mod doesn't own a path for.
     * @param {PortItemSetEvent|PortItemClearEvent} event
     * @private
     */
    _handlePortItemEvent(event) {
        const portId = event.portId;
        if (!this._outPortToPath.has(portId)) {
            return;
        }
        if (event instanceof PortItemClearEvent) {
            this._itemLayer.removeItem(PORT_SPRITE_KEY(portId));
            return;
        }
        this._renderPortItem(portId, event.itemType);
    }

    /**
     * Places a belt path out-port's item sprite at its output boundary: the tile downstream of
     * the tail, on the upstream edge where the item just popped off.
     * @param {number} portId
     * @param {number} type - item type, selecting the sprite texture
     * @private
     */
    _renderPortItem(portId, type) {
        const port = this._resolvePortBelt(portId);
        if (port === null) {
            return;
        }
        this._itemLayer.moveItem(PORT_SPRITE_KEY(portId), port.tileX, port.tileY, true, port.sourceDirection, type);
    }

    /**
     * The tile an out-port's item rests on: one downstream of the path's tail (output)
     * belt, with sourceDirection pointing back at the tail (the edge it popped off). Returns
     * null when the path or belt isn't cached yet.
     * @param {number} portId
     * @returns {{tileX: number, tileY: number, sourceDirection: Direction}|null}
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
            sourceDirection: Direction.invert(direction),
        };
    }

    /**
     * Drops out-port item sprites whose path head left the viewport.
     * @param {Set<number>} removedHeads
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
     * @param {number} deletedBelt
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
     * Applies one item delta: an upsert inserts-or-resizes a run, a delete drops one. Either way the
     * path's items are repositioned, since one run change shifts the whole path.
     * @param {BeltItemUpsertEvent|BeltItemSyncEvent|BeltItemDeleteEvent|BeltItemResetEvent} event
     * @private
     */
    _handleItemEvent(event) {
        const pathId = event.pathId;
        if (event instanceof BeltItemResetEvent) {
            this._resetPathItems(pathId);
            return;
        }
        const runId = event.runId;
        if (event instanceof BeltItemDeleteEvent) {
            const runs = this._pathItems.get(pathId);
            const run = runs === undefined ? undefined : runs.get(runId);
            this._dropDeletedItem(pathId, runId, run);
            if (runs !== undefined) {
                runs.delete(runId);
            }
            this._recomputePathItems(pathId);
            return;
        }
        let runs = this._pathItems.get(pathId);
        if (runs === undefined) {
            runs = new Map();
            this._pathItems.set(pathId, runs);
        }
        runs.set(runId, {length: event.length, type: event.itemType});
        // A synced run was only re-keyed, not moved, so place its sprite without animating.
        this._recomputePathItems(pathId, event instanceof BeltItemSyncEvent);
    }

    /**
     * Disposes a deleted item's sprite. A non-gap delete on a path with an out-port is a
     * pop (edits re-sync via RESET, not DELETE): hand the sprite to the out-port so it
     * glides the last stretch in — replacing the previous occupant, which the downstream
     * path's freshly-ingested item already covers — instead of vanishing while the
     * same-type (so un-refreshed) port sprite sits still. Anything else is just removed.
     * @param {number} pathId
     * @param {number} runId
     * @param {{length: number, type: number}|undefined} run - the item's RLE run, if tracked
     * @private
     */
    _dropDeletedItem(pathId, runId, run) {
        const outPortId = this._pathToOutPort.get(pathId);
        if (run === undefined || run.type === ITEM_TYPE_GAP || outPortId === undefined) {
            this._itemLayer.removeItem(runId);
            return;
        }
        this._itemLayer.renameItem(runId, PORT_SPRITE_KEY(outPortId));
        this._renderPortItem(outPortId, run.type);
    }

    /**
     * Clears the item sprites/runs of a path about to be re-synced, under every belt in
     * it — the head and any former heads a merge folded in — so no stale sprite survives
     * the re-keyed rebuild. The following re-emitted UPSERT runs (same drain) repopulate it.
     * @param {number} pathId
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
     * Repositions every item on a path from its RLE runs. Runs lie output-to-input in
     * ascending id order; walking input-to-output (descending id) and accumulating
     * lengths gives each run's slot = head_gap + lengths nearer the input, where
     * head_gap = path length − Σ run lengths.
     * @param {number} pathId
     * @param {boolean} [snap] - place sprites without animating (a re-sync, not a move)
     * @private
     */
    _recomputePathItems(pathId, snap=false) {
        const parts = this._pathParts.get(pathId);
        const runs = this._pathItems.get(pathId);
        if (parts === undefined || runs === undefined) {
            return;
        }
        const pathLength = 2 * parts.length - 1;
        let total = 0;
        runs.forEach(run => {
            total += run.length;
        });
        let slot = pathLength - total;
        const runIds = Array.from(runs.keys()).sort((a, b) => (a < b ? 1 : -1));
        runIds.forEach(runId => {
            const run = runs.get(runId);
            if (run.type !== ITEM_TYPE_GAP) {
                const belt = this._resolveItemBelt(pathId, slot);
                if (belt !== null) {
                    this._itemLayer.moveItem(runId, belt.tileX, belt.tileY, belt.halfTile, belt.sourceDirection, run.type, snap, belt.hidden);
                }
            }
            slot += run.length;
        });
    }

    /**
     * Drops a path's item sprites and tracked runs (head removed, or about to be re-synced).
     * @param {number} pathId
     * @private
     */
    _clearPathItems(pathId) {
        const runs = this._pathItems.get(pathId);
        if (runs === undefined) {
            return;
        }
        runs.forEach((run, runId) => {
            this._itemLayer.removeItem(runId);
        });
        this._pathItems.delete(pathId);
    }

    /**
     * Maps an item's path and slot to the belt it sits on. slot counts half-tiles
     * from the input (head); each belt past the head owns a full then a half slot, so
     * the belt is parts[(N-1) - floor((slot+1)/2)] and an odd slot is the half-tile
     * straddle. sourceDirection points at the belt feeding this one (the bend's input edge).
     * Returns null when the path or belt isn't cached yet.
     * @param {number} pathId
     * @param {number} slot
     * @returns {{tileX: number, tileY: number, sourceDirection: Direction, halfTile: boolean, hidden: boolean}|null}
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
        const halfTile = slot % 2 === 1;
        // A non-head belt's feeder is the next part toward the input; only the head
        // (fed through its in-port by an unknown neighbor) needs cache inference.
        const sourceDirection = beltIndex + 1 < parts.length
            ? this._pathSourceDirection(record, parts[beltIndex + 1])
            : this._sourceDirection(record);
        return {
            tileX: record.tileX,
            tileY: record.tileY,
            sourceDirection: sourceDirection,
            halfTile: halfTile,
            // Boundary half slots: a ramp-up's is still buried; the first buried tile's
            // renders, covered by the roof and threshold occluders.
            hidden: (record.data.type === BeltType.UNDERGROUND
                    && !(halfTile && this._rampDownBehind(record)))
                || (record.data.type === BeltType.RAMP_UP && halfTile),
        };
    }

    /**
     * Whether the tile behind a buried belt (toward its source) holds the tunnel's
     * entrance ramp — marking it as the first buried tile.
     * @param {CacheEntry} record - underground belt cache entry
     * @returns {boolean}
     * @private
     */
    _rampDownBehind(record) {
        const direction = record.data.direction;
        const behind = this._cache.getAtTile(
            record.tileX - Direction.dx(direction),
            record.tileY - Direction.dy(direction),
        );
        return behind.some(neighbor =>
            neighbor.data.type === BeltType.RAMP_DOWN && neighbor.data.direction === direction);
    }

    /**
     * The direction toward the path belt feeding `record`; opposite the flow when the
     * feeder isn't cached.
     * @param {CacheEntry} record - belt cache entry
     * @param {number} feederId - the next part toward the input
     * @returns {Direction}
     * @private
     */
    _pathSourceDirection(record, feederId) {
        const feeder = this._cache.get(feederId);
        if (feeder === null) {
            return Direction.invert(record.data.direction);
        }
        return Direction.fromDelta(
            Math.sign(feeder.tileX - record.tileX),
            Math.sign(feeder.tileY - record.tileY),
        );
    }

    /**
     * The direction toward the object feeding a head belt through its in-port — the side
     * an item enters from, inferred from the cache. Falls back to opposite the flow when
     * no feeder is cached.
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
     * A ramp also masks the item layer with its roof, so items seem to pass beneath it.
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
        // Bend is derived from neighbors by the belt layer on structural cache changes; added straight.
        this._beltLayer.addBelt(event.id, event.x, event.y, event.direction, event.beltType);
        if (isRamp(event.beltType)) {
            this._addRampMasks(event);
        }
    }

    /**
     * Adds a ramp's two item occluders: a roof over its own tile and a threshold strip on the
     * buried neighbor.
     * @param {BeltInsertEvent|BeltSyncEvent} event
     * @private
     */
    _addRampMasks(event) {
        // A RAMP_DOWN's roof sits on its up edge (the tunnel mouth it faces into), a RAMP_UP's
        // on its down edge (where items surface); the facing rotation orients both.
        const roofY = event.beltType === BeltType.RAMP_UP ? TILE_SIZE - 36 : 0;
        const roof = new Rectangle(0, roofY, TILE_SIZE, 36);
        this._itemLayer.addMask(`roof:${event.id}`, event.x, event.y, roof, event.direction);
        const step = tunnelStep(event.beltType, event.direction);
        // The band sits on the rect's up edge; rotating by the direction from the threshold
        // tile back toward the ramp lands it on the shared edge.
        const edgeDirection = Direction.fromDelta(-step.dx, -step.dy);
        const threshold = new Rectangle(0, 0, TILE_SIZE, TILE_SIZE / 4);
        this._itemLayer.addMask(`threshold:${event.id}`, event.x + step.dx, event.y + step.dy, threshold, edgeDirection);
    }

    /**
     * Removes a ramp's roof and threshold occluders.
     * @param {number} id - the ramp's belt id
     * @private
     */
    _removeRampMasks(id) {
        this._itemLayer.removeMask(`roof:${id}`);
        this._itemLayer.removeMask(`threshold:${id}`);
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
        const ramp = records.find(record => isRamp(record.data.type));
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
        const entries = [];
        const surface = surfaceBeltAt(this._cache, tileX, tileY);
        if (surface !== null) {
            entries.push(new MiniMenuEntry(
                "Delete Belt",
                10,
                () => session.sendMessage(new DeleteObjectMessage(surface.id)),
            ));
        }
        const splitter = this._cache.objectAt(tileX, tileY, SplitterDefinition);
        if (splitter !== null) {
            entries.push(new MiniMenuEntry(
                "Delete Splitter",
                10,
                () => session.sendMessage(new DeleteObjectMessage(splitter.id)),
            ));
        }
        return entries;
    }

}
