
import {BeltDrawLayer} from "./client/BeltDrawLayer.js";
import {BeltOverlayDrawLayer} from "./client/BeltOverlayDrawLayer.js";
import {BeltGhostLayer} from "./client/BeltGhostLayer.js";
import {PathDebugDrawLayer} from "./client/PathDebugDrawLayer.js";
import {BeltTool} from "./client/BeltTool.js";
import {UndergroundBeltTool} from "./client/UndergroundBeltTool.js";
import {LOGISTICS_SCHEMA, LogisticsWriter} from "./client/LogisticsState.js";
import {WireDrawLayer} from "./client/WireDrawLayer.js";
import {WireTool} from "./client/WireTool.js";
import {isBeltType, isGateType, isPoleType} from "./common/objectTypes.js";
import {
    BeltPathRecalculateEvent,
    BeltItemUpsertEvent,
    BeltItemSyncEvent,
    BeltItemDeleteEvent,
    BeltItemResetEvent,
    ControlWireSetEvent,
    ControlWireClearEvent,
} from "./common/events.js";
import {tunnelStep, BELT_TUNNEL_DOWN, BELT_TUNNEL_UP, BELT_UNDERGROUND} from "./common/constants.js";
import {walkTunnel, isTunnelMouth, inferBeltParent} from "./common/geometry.js";
import {placementBlockedByGate, gateConnections} from "./common/gateConnections.js";
import {
    AbstractClientMod,
    ObjectInsertEvent,
    PortItemSetEvent,
    PortItemClearEvent,
    TickEndEvent,
    Direction,
    PORT_SPRITE_KEY,
    InspectHighlight,
    Rectangle,
    TILE_SIZE,
    LAYER_SURFACE,
    CONVEYS_ITEM,
    CONVEYS_FLUID,
} from "@spup/sdk/client";

/**
 * A pop whose sprite hand-off into its out-port waits on the occupant's fate.
 */
class PendingPop {

    /**
     * @param {number} itemId - the popped item's sprite key
     * @param {number} type - item type
     */
    constructor(itemId, type) {
        this.itemId = itemId;
        this.type = type;
    }
}

export class LogisticsClientMod extends AbstractClientMod {

    constructor() {
        super();
        // Shared between drawLayers (renders it) and tools (drive it).
        this._ghostLayer = new BeltGhostLayer();
        // Driven imperatively by onEvent.
        this._beltLayer = new BeltDrawLayer();
        // Reveals buried tunnel belts under a hovered mouth.
        this._overlayLayer = new BeltOverlayDrawLayer();
        // Head id → belt ids in path order (head last).
        this._pathParts = new Map();
        // Head id → Map<item id, {gap, type}>, output-to-input; positions derived from gaps.
        this._pathItems = new Map();
        // Out-port id → path head id, so a port-item event (port id only) resolves to a path.
        this._outPortToPath = new Map();
        // Inverse map, so a lead item's DELETE (a pop) hands its sprite to the out-port.
        this._pathToOutPort = new Map();
        // Out-port id → pop whose hand-off waits on the occupant's fate: a consumed CLEAR glides
        // the occupant into the consumer first; TickEndEvent flushes the rest (occupant ingested
        // downstream, its sprite simply replaced).
        this._pendingPops = new Map();
        // Debug overlay of belt paths.
        this._pathDebugLayer = new PathDebugDrawLayer(this._pathParts);
        // Catenary overlay for the control network, fed in setup.
        this._wireLayer = new WireDrawLayer();
    }

    drawLayers(client) {
        return [
            this._beltLayer,
            this._overlayLayer,
            this._ghostLayer,
            this._pathDebugLayer,
            this._wireLayer,
        ];
    }

    tools(client) {
        // TODO: Filter to the tools available for the player (playerSettings state).
        return [
            new BeltTool(client, this._ghostLayer),
            new UndergroundBeltTool(client, this._ghostLayer),
            new WireTool(client, this._wireLayer),
        ];
    }

    /**
     * Registers cache listeners keeping belt rendering in lockstep with every belt entry.
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        client.cache.register("logistics", LOGISTICS_SCHEMA, new LogisticsWriter(client.cache, client.session));
        this._wireLayer.bindObjects(client.objects);
        client.cache.subscribe("logistics.linkPoleById", (id, poleId) => this._wireLayer.setLink(id, poleId));
        // Patching the entry swaps the sprite through the derived layer's onCacheUpdate.
        client.cache.subscribe("logistics.openById", (id, open) => {
            client.objects.update(id, {gateOpen: open !== 0});
        });
        client.cache.subscribe("logistics.fluidById", (id, fluid) => {
            client.objects.update(id, {gateFluid: fluid === 1});
        });
        client.objects.onSet(entry => {
            if (isBeltType(entry.data.type)) {
                this._onBeltSet(client, entry);
            }
            if (isGateType(entry.data.type)) {
                // A re-set entry's data starts fresh; re-apply any cached off-default state.
                const open = client.cache.mapGet("logistics.openById", entry.id);
                const fluid = client.cache.mapGet("logistics.fluidById", entry.id);
                if (open !== undefined || fluid !== undefined) {
                    client.objects.update(entry.id, {gateOpen: open !== 0, gateFluid: fluid === 1});
                }
                this._predictGateMode(client, entry);
            }
            if (entry.data.type.conveys !== null) {
                this._predictNeighborGateModes(client, entry);
            }
            if (isPoleType(entry.data.type)) {
                this._wireLayer.addPole(entry);
            }
        });
        client.objects.onRemove(entry => {
            if (isBeltType(entry.data.type)) {
                this._onBeltRemoved(client, entry);
            }
            if (isGateType(entry.data.type)) {
                client.cache.writer("logistics").forget(entry.id);
            }
            if (isPoleType(entry.data.type)) {
                this._wireLayer.removePole(entry.id);
            }
            if (entry.data.type.wireAnchor !== null && !isPoleType(entry.data.type)) {
                client.cache.writer("logistics").forgetLink(entry.id);
            }
        });
    }

    /**
     * Mirrors the sim's gate placement guard.
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {Client} client
     * @returns {boolean}
     */
    canPlace(type, tileX, tileY, direction, client) {
        return !placementBlockedByGate(
            this._occupantAt(client),
            occupant => isGateType(occupant.type),
            type, tileX, tileY, direction,
        );
    }

    /**
     * The SURFACE occupant resolver the shared connection rules use.
     * @private
     * @param {Client} client
     * @returns {function(number, number): ({type: ObjectType, direction: Direction}|null)}
     */
    _occupantAt(client) {
        return (x, y) => {
            const entry = client.objects.at(x, y, LAYER_SURFACE);
            if (entry === null) {
                return null;
            }
            return {type: entry.data.type, direction: entry.data.direction};
        };
    }

    /**
     * Predicts a gate's mode from its coupled transports, a tick ahead of the sim's review.
     * @private
     * @param {Client} client
     * @param {CacheEntry} entry - the gate's entry
     * @returns {void}
     */
    _predictGateMode(client, entry) {
        const kinds = gateConnections(this._occupantAt(client), entry.tileX, entry.tileY, entry.data.direction);
        const hasItem = kinds.behind === CONVEYS_ITEM || kinds.front === CONVEYS_ITEM;
        const hasFluid = kinds.behind === CONVEYS_FLUID || kinds.front === CONVEYS_FLUID;
        if (hasFluid && !hasItem) {
            client.cache.writer("logistics").predictFluid(entry.id, 1);
        } else if (hasItem && !hasFluid) {
            client.cache.writer("logistics").predictFluid(entry.id, 0);
        }
    }

    /**
     * Re-predicts the mode of every gate a set transport entry touches.
     * @private
     * @param {Client} client
     * @param {CacheEntry} entry - the transport's entry
     * @returns {void}
     */
    _predictNeighborGateModes(client, entry) {
        for (const cell of entry.cells) {
            if (cell.layer !== LAYER_SURFACE) {
                continue;
            }
            for (let direction = 0; direction < 4; direction += 1) {
                const neighbor = client.objects.at(
                    cell.x + Direction.dx(direction),
                    cell.y + Direction.dy(direction),
                    LAYER_SURFACE,
                );
                if (neighbor !== null && isGateType(neighbor.data.type)) {
                    this._predictGateMode(client, neighbor);
                }
            }
        }
    }

    /**
     * Single client-side hub for the belt path/item events.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onEvent(event, client) {
        if (event instanceof TickEndEvent) {
            for (const portId of this._pendingPops.keys()) {
                this._flushPendingPop(client, portId);
            }
            return;
        }
        if (event instanceof ObjectInsertEvent && isBeltType(client.modRegistry.typeById(event.typeId))) {
            // A live insert's recalc precedes the belt, so repaint once it is cached.
            this._pathDebugLayer.markStale();
            return;
        }
        if (event instanceof ControlWireSetEvent) {
            this._wireLayer.setEdge(event.aObjectId, event.bObjectId);
            return;
        }
        if (event instanceof ControlWireClearEvent) {
            this._wireLayer.removeEdge(event.aObjectId, event.bObjectId);
            return;
        }
        if (event instanceof BeltPathRecalculateEvent) {
            this._updatePath(event.parts);
            if (event.outPortId !== null) {
                const head = event.parts[event.parts.length - 1];
                this._outPortToPath.set(event.outPortId, head);
                this._pathToOutPort.set(head, event.outPortId);
            }
            this._pathDebugLayer.markStale();
            return;
        }
        if (event instanceof PortItemSetEvent || event instanceof PortItemClearEvent) {
            this._handlePortItemEvent(client, event);
            return;
        }
        if (event instanceof BeltItemUpsertEvent
            || event instanceof BeltItemSyncEvent
            || event instanceof BeltItemDeleteEvent
            || event instanceof BeltItemResetEvent) {
            this._handleItemEvent(client, event);
        }
    }

    /**
     * Records a recalculated path under its head id, dropping any head a merge absorbed.
     * @param {number[]} parts - belt ids in path order, head last
     * @private
     */
    _updatePath(parts) {
        const head = parts[parts.length - 1];
        for (const id of parts) {
            if (id !== head) {
                this._pathParts.delete(id);
            }
        }
        this._pathParts.set(head, parts);
    }

    /**
     * Renders or removes an item resting in a path's out-port; untracked ports are engine-rendered splitters.
     * @param {Client} client
     * @param {PortItemSetEvent|PortItemClearEvent} event
     * @private
     */
    _handlePortItemEvent(client, event) {
        const portId = event.portId;
        if (!this._outPortToPath.has(portId)) {
            return;
        }
        if (event instanceof PortItemClearEvent) {
            this._clearPortItem(client, portId, event.consumed === 1);
            return;
        }
        // Rename only: the render below places the sprite with the event's own item type.
        this._takePendingPop(client, portId);
        this._renderPortItem(client, portId, event.itemType);
    }

    /**
     * Drops an out-port's item sprite — a consumed one glides on into the consumer instead —
     * then hands the port to any pop waiting on it.
     * @param {Client} client
     * @param {number} portId
     * @param {boolean} consumed
     * @private
     */
    _clearPortItem(client, portId, consumed) {
        const key = PORT_SPRITE_KEY(portId);
        const port = consumed ? this._resolvePortBelt(client, portId) : null;
        if (port !== null) {
            client.itemLayer.consumeItem(key, port.sourceDirection);
        } else {
            client.itemLayer.removeItem(key);
        }
        this._flushPendingPop(client, portId);
    }

    /**
     * Applies a deferred pop: renames its belt sprite into the (now settled) out-port and
     * renders it there.
     * @param {Client} client
     * @param {number} portId
     * @private
     */
    _flushPendingPop(client, portId) {
        const pop = this._takePendingPop(client, portId);
        if (pop === null) {
            return;
        }
        this._renderPortItem(client, portId, pop.type);
    }

    /**
     * Claims a deferred pop and renames its belt sprite into the out-port; null when none waits.
     * @param {Client} client
     * @param {number} portId
     * @returns {PendingPop|null}
     * @private
     */
    _takePendingPop(client, portId) {
        const pop = this._pendingPops.get(portId);
        if (pop === undefined) {
            return null;
        }
        this._pendingPops.delete(portId);
        client.itemLayer.renameItem(pop.itemId, PORT_SPRITE_KEY(portId));
        return pop;
    }

    /**
     * Places an out-port's item sprite one tile downstream of the tail, on the upstream edge.
     * @param {Client} client
     * @param {number} portId
     * @param {number} type - item type
     * @private
     */
    _renderPortItem(client, portId, type) {
        const port = this._resolvePortBelt(client, portId);
        if (port === null) {
            return;
        }
        client.itemLayer.moveItem({
            key: PORT_SPRITE_KEY(portId),
            tileX: port.tileX,
            tileY: port.tileY,
            halfTile: true,
            sourceDirection: port.sourceDirection,
            type,
        });
    }

    /**
     * The tile an out-port's item rests on: one downstream of the tail, facing back at it; null when uncached.
     * @param {Client} client
     * @param {number} portId
     * @returns {{tileX: number, tileY: number, sourceDirection: Direction}|null}
     * @private
     */
    _resolvePortBelt(client, portId) {
        const head = this._outPortToPath.get(portId);
        if (head === undefined) {
            return null;
        }
        const parts = this._pathParts.get(head);
        if (parts === undefined) {
            return null;
        }
        const tail = client.objects.get(parts[0]);
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
     * Applies one item delta and repositions the path's items — gaps are relative, so one change shifts the rest.
     * @param {Client} client
     * @param {BeltItemUpsertEvent|BeltItemSyncEvent|BeltItemDeleteEvent|BeltItemResetEvent} event
     * @private
     */
    _handleItemEvent(client, event) {
        const pathId = event.pathId;
        if (event instanceof BeltItemResetEvent) {
            this._resetPathItems(client, pathId);
            return;
        }
        const itemId = event.itemId;
        if (event instanceof BeltItemDeleteEvent) {
            const items = this._pathItems.get(pathId);
            const item = items === undefined ? undefined : items.get(itemId);
            this._dropDeletedItem(client, pathId, itemId, item);
            if (items !== undefined) {
                items.delete(itemId);
            }
            this._recomputePathItems(client, pathId);
            return;
        }
        let items = this._pathItems.get(pathId);
        if (items === undefined) {
            items = new Map();
            this._pathItems.set(pathId, items);
        }
        items.set(itemId, {gap: event.gap, type: event.itemType});
        // A synced item was only re-keyed, not moved, so place its sprite without animating.
        this._recomputePathItems(client, pathId, event instanceof BeltItemSyncEvent);
    }

    /**
     * Destroys a deleted item's sprite; a delete on an out-port path is a pop, so the sprite glides into the port.
     * @param {Client} client
     * @param {number} pathId
     * @param {number} itemId
     * @param {{gap: number, type: number}|undefined} item - the tracked item, if known
     * @private
     */
    _dropDeletedItem(client, pathId, itemId, item) {
        const outPortId = this._pathToOutPort.get(pathId);
        if (item === undefined || outPortId === undefined) {
            client.itemLayer.removeItem(itemId);
            return;
        }
        const portKey = PORT_SPRITE_KEY(outPortId);
        if (client.itemLayer.hasItem(portKey)) {
            // The occupant's fate lands later this tick: a consumed CLEAR glides it into the
            // consumer, a downstream ingest simply replaces its sprite. Defer the hand-off.
            this._pendingPops.set(outPortId, new PendingPop(itemId, item.type));
            return;
        }
        client.itemLayer.renameItem(itemId, portKey);
        this._renderPortItem(client, outPortId, item.type);
    }

    /**
     * Clears a re-syncing path's sprites under head and merged-in former heads; re-emitted UPSERTs repopulate.
     * @param {Client} client
     * @param {number} pathId
     * @private
     */
    _resetPathItems(client, pathId) {
        const parts = this._pathParts.get(pathId);
        if (parts === undefined) {
            this._clearPathItems(client, pathId);
            return;
        }
        for (const id of parts) {
            this._clearPathItems(client, id);
        }
    }

    /**
     * Repositions a path's items: they lie output-to-input, each gap counting the empty half-tiles ahead of it.
     * @param {Client} client
     * @param {number} pathId
     * @param {boolean} [snap] - place sprites without animating
     * @private
     */
    _recomputePathItems(client, pathId, snap=false) {
        const parts = this._pathParts.get(pathId);
        const items = this._pathItems.get(pathId);
        if (parts === undefined || items === undefined) {
            return;
        }
        const outputSlot = 2 * parts.length - 2;
        let position = 0;
        for (const [itemId, item] of items) {
            position += item.gap;
            // `position` counts from the output edge; belt slots count from the input edge.
            const belt = this._resolveItemBelt(client, pathId, outputSlot - position);
            if (belt !== null) {
                client.itemLayer.moveItem({
                    key: itemId,
                    tileX: belt.tileX,
                    tileY: belt.tileY,
                    halfTile: belt.halfTile,
                    sourceDirection: belt.sourceDirection,
                    type: item.type,
                    snap,
                    hidden: belt.hidden,
                });
            }
            position += 1;
        }
    }

    /**
     * Drops a path's item sprites and tracked items.
     * @param {Client} client
     * @param {number} pathId
     * @private
     */
    _clearPathItems(client, pathId) {
        const items = this._pathItems.get(pathId);
        if (items === undefined) {
            return;
        }
        for (const itemId of items.keys()) {
            client.itemLayer.removeItem(itemId);
        }
        this._pathItems.delete(pathId);
    }

    /**
     * Maps an item's slot to its belt: slot counts half-tiles from the input, so the belt is
     * parts[(N-1) - floor((slot+1)/2)] and an odd slot is the half-tile straddle.
     * @param {Client} client
     * @param {number} pathId
     * @param {number} slot
     * @returns {{tileX: number, tileY: number, sourceDirection: Direction, halfTile: boolean, hidden: boolean}|null}
     * @private
     */
    _resolveItemBelt(client, pathId, slot) {
        const parts = this._pathParts.get(pathId);
        if (parts === undefined) {
            return null;
        }
        const beltIndex = (parts.length - 1) - Math.floor((slot + 1) / 2);
        if (beltIndex < 0 || beltIndex >= parts.length) {
            return null;
        }
        const record = client.objects.get(parts[beltIndex]);
        if (record === null) {
            return null;
        }
        const halfTile = slot % 2 === 1;
        // Only the head (fed by an unknown neighbor) needs cache inference.
        const sourceDirection = beltIndex + 1 < parts.length
            ? this._pathSourceDirection(client, record, parts[beltIndex + 1])
            : this._sourceDirection(client, record);
        return {
            tileX: record.tileX,
            tileY: record.tileY,
            sourceDirection: sourceDirection,
            halfTile: halfTile,
            // Boundary half slots: a tunnel-up's is still buried; the first buried tile's renders under the occluders.
            hidden: (record.data.type.beltKind === BELT_UNDERGROUND
                    && !(halfTile && this._tunnelDownBehind(client, record)))
                || (record.data.type.beltKind === BELT_TUNNEL_UP && halfTile),
        };
    }

    /**
     * Whether the tile behind a buried belt holds the tunnel's entrance mouth (first buried tile).
     * @param {Client} client
     * @param {CacheEntry} record - underground belt cache entry
     * @returns {boolean}
     * @private
     */
    _tunnelDownBehind(client, record) {
        const direction = record.data.direction;
        const behind = client.objects.getAtTile(
            record.tileX - Direction.dx(direction),
            record.tileY - Direction.dy(direction),
        );
        return behind.some(neighbor =>
            neighbor.data.type.beltKind === BELT_TUNNEL_DOWN && neighbor.data.direction === direction);
    }

    /**
     * The direction toward the path belt feeding `record`; opposite the flow when uncached.
     * @param {Client} client
     * @param {CacheEntry} record - belt cache entry
     * @param {number} feederId - the next part toward the input
     * @returns {Direction}
     * @private
     */
    _pathSourceDirection(client, record, feederId) {
        const feeder = client.objects.get(feederId);
        if (feeder === null) {
            return Direction.invert(record.data.direction);
        }
        return Direction.fromDelta(
            Math.sign(feeder.tileX - record.tileX),
            Math.sign(feeder.tileY - record.tileY),
        );
    }

    /**
     * The direction an item enters a head belt from; opposite the flow when no feeder is cached.
     * @param {Client} client
     * @param {CacheEntry} record - belt cache entry
     * @returns {Direction}
     * @private
     */
    _sourceDirection(client, record) {
        const {parentX, parentY} = inferBeltParent(client.objects, record.tileX, record.tileY, record.data.direction);
        if (parentX !== null && parentY !== null) {
            return Direction.fromDelta(Math.sign(parentX - record.tileX), Math.sign(parentY - record.tileY));
        }
        return Direction.invert(record.data.direction);
    }

    /**
     * Adds a cached belt entry to the draw layer; a mouth also masks the item layer with its roof.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _onBeltSet(client, entry) {
        const kind = entry.data.type.beltKind;
        // Added straight; the belt layer re-derives the bend on structural cache changes.
        this._beltLayer.addBelt(entry.id, entry.tileX, entry.tileY, entry.data.direction, kind);
        if (isTunnelMouth(kind)) {
            this._addTunnelMasks(client, entry);
        }
    }

    /**
     * Clears everything hanging off a removed belt entry.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _onBeltRemoved(client, entry) {
        const id = entry.id;
        this._beltLayer.removeBelt(id);
        if (isTunnelMouth(entry.data.type.beltKind)) {
            this._removeTunnelMasks(client, id);
        }
        this._clearPathItems(client, id);
        // Sprite goes when the removed belt renders the port item or heads the path; mapping goes only with the head.
        for (const [head, portId] of this._pathToOutPort) {
            const parts = this._pathParts.get(head);
            const rendersHere = parts !== undefined && parts[0] === id;
            if (rendersHere || head === id) {
                client.itemLayer.removeItem(PORT_SPRITE_KEY(portId));
            }
            if (head === id) {
                this._outPortToPath.delete(portId);
                this._pathToOutPort.delete(head);
            }
        }
        if (this._pathParts.delete(id)) {
            this._pathDebugLayer.markStale();
        }
    }

    /**
     * Adds a mouth's item occluders: a roof on its own tile and a threshold strip on the buried neighbor.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _addTunnelMasks(client, entry) {
        const kind = entry.data.type.beltKind;
        const direction = entry.data.direction;
        // TUNNEL_DOWN roofs its up edge (tunnel mouth), TUNNEL_UP its down edge (where items surface).
        const roofY = kind === BELT_TUNNEL_UP ? TILE_SIZE - 36 : 0;
        const roof = new Rectangle(0, roofY, TILE_SIZE, 36);
        client.itemLayer.addMask(`roof:${entry.id}`, entry.tileX, entry.tileY, roof, direction);
        const step = tunnelStep(kind, direction);
        // Rotating by the direction back toward the mouth lands the band on the shared edge.
        const edgeDirection = Direction.fromDelta(-step.dx, -step.dy);
        const threshold = new Rectangle(0, 0, TILE_SIZE, TILE_SIZE / 4);
        client.itemLayer.addMask(`threshold:${entry.id}`, entry.tileX + step.dx, entry.tileY + step.dy, threshold, edgeDirection);
    }

    /**
     * Removes a mouth's roof and threshold occluders.
     * @param {Client} client
     * @param {number} id - the mouth's belt id
     * @private
     */
    _removeTunnelMasks(client, id) {
        client.itemLayer.removeMask(`roof:${id}`);
        client.itemLayer.removeMask(`threshold:${id}`);
    }

    /**
     * Tool-less hover: reveal the buried tunnel under a hovered mouth and highlight both its ends.
     * Plain belts draw no highlight.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @param {Client} client
     * @returns {InspectHighlight[]}
     */
    onInspect(tileX, tileY, client) {
        if (tileX === null) {
            this._overlayLayer.clearUndergroundReveal();
            return [];
        }
        const records = client.objects.getAtTile(tileX, tileY);
        const mouth = records.find(record => isBeltType(record.data.type) && isTunnelMouth(record.data.type.beltKind));
        const tunnel = mouth === undefined ? null : walkTunnel(client.objects, mouth);
        if (tunnel === null) {
            this._overlayLayer.clearUndergroundReveal();
        } else {
            this._overlayLayer.showUndergroundReveal(tunnel.tiles, mouth.data.direction);
        }
        if (mouth === undefined) {
            return [];
        }
        // The hovered mouth, plus the mouth it tunnels to (alternate highlight).
        const highlights = [new InspectHighlight(mouth.tileX, mouth.tileY, mouth.data.direction, mouth.data.type)];
        if (tunnel !== null && tunnel.pair !== null) {
            highlights.push(new InspectHighlight(
                tunnel.pair.tileX,
                tunnel.pair.tileY,
                tunnel.pair.data.direction,
                tunnel.pair.data.type,
                true,
            ));
        }
        return highlights;
    }

}
