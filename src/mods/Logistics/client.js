
import {BeltDrawLayer} from "./client/BeltDrawLayer.js";
import {BeltOverlayDrawLayer} from "./client/BeltOverlayDrawLayer.js";
import {BeltGhostLayer} from "./client/BeltGhostLayer.js";
import {PathDebugDrawLayer} from "./client/PathDebugDrawLayer.js";
import {BeltTool} from "./client/BeltTool.js";
import {UndergroundBeltTool} from "./client/UndergroundBeltTool.js";
import {isBeltType} from "./common/objectTypes.js";
import {
    BeltPathRecalculateEvent,
    BeltItemUpsertEvent,
    BeltItemSyncEvent,
    BeltItemDeleteEvent,
    BeltItemResetEvent,
} from "./common/events.js";
import {tunnelStep, BELT_RAMP_DOWN, BELT_RAMP_UP, BELT_UNDERGROUND} from "./common/constants.js";
import {walkTunnel, isRamp, inferBeltParent} from "./common/geometry.js";
import {
    AbstractClientMod,
    ObjectInsertEvent,
    PortItemSetEvent,
    PortItemClearEvent,
    Direction,
    PORT_SPRITE_KEY,
    Rectangle,
    TILE_SIZE,
} from "@spup/sdk/client";

export class LogisticsClientMod extends AbstractClientMod {

    constructor() {
        super();
        // Shared between drawLayers (renders it) and tools (drive it).
        this._ghostLayer = new BeltGhostLayer();
        // Driven imperatively by onEvent.
        this._beltLayer = new BeltDrawLayer();
        // Reveals buried tunnel belts under a hovered ramp.
        this._overlayLayer = new BeltOverlayDrawLayer();
        // Head id → belt ids in path order (head last).
        this._pathParts = new Map();
        // Head id → Map<item id, {gap, type}>, output-to-input; positions derived from gaps.
        this._pathItems = new Map();
        // Out-port id → path head id, so a port-item event (port id only) resolves to a path.
        this._outPortToPath = new Map();
        // Inverse map, so a lead item's DELETE (a pop) hands its sprite to the out-port.
        this._pathToOutPort = new Map();
        // Debug overlay of belt paths.
        this._pathDebugLayer = new PathDebugDrawLayer(this._pathParts);
    }

    drawLayers(client) {
        return [
            this._beltLayer,
            this._overlayLayer,
            this._ghostLayer,
            this._pathDebugLayer,
        ];
    }

    tools(client) {
        // TODO: Filter to the tools available for the player (playerSettings state).
        return [
            new BeltTool(client, this._ghostLayer),
            new UndergroundBeltTool(client, this._ghostLayer),
        ];
    }

    /**
     * Registers cache listeners keeping belt rendering in lockstep with every belt entry.
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        client.objects.onSet(entry => {
            if (isBeltType(entry.data.type)) {
                this._onBeltSet(client, entry);
            }
        });
        client.objects.onRemove(entry => {
            if (isBeltType(entry.data.type)) {
                this._onBeltRemoved(client, entry);
            }
        });
    }

    /**
     * Single client-side hub for the belt path/item events.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onEvent(event, client) {
        if (event instanceof ObjectInsertEvent && isBeltType(client.modRegistry.typeById(event.typeId))) {
            // A live insert's recalc precedes the belt, so repaint once it is cached.
            this._pathDebugLayer.markStale();
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
            client.itemLayer.removeItem(PORT_SPRITE_KEY(portId));
            return;
        }
        this._renderPortItem(client, portId, event.itemType);
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
        client.itemLayer.renameItem(itemId, PORT_SPRITE_KEY(outPortId));
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
            // Boundary half slots: a ramp-up's is still buried; the first buried tile's renders under the occluders.
            hidden: (record.data.type.beltKind === BELT_UNDERGROUND
                    && !(halfTile && this._rampDownBehind(client, record)))
                || (record.data.type.beltKind === BELT_RAMP_UP && halfTile),
        };
    }

    /**
     * Whether the tile behind a buried belt holds the tunnel's entrance ramp (first buried tile).
     * @param {Client} client
     * @param {CacheEntry} record - underground belt cache entry
     * @returns {boolean}
     * @private
     */
    _rampDownBehind(client, record) {
        const direction = record.data.direction;
        const behind = client.objects.getAtTile(
            record.tileX - Direction.dx(direction),
            record.tileY - Direction.dy(direction),
        );
        return behind.some(neighbor =>
            neighbor.data.type.beltKind === BELT_RAMP_DOWN && neighbor.data.direction === direction);
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
     * Adds a cached belt entry to the draw layer; a ramp also masks the item layer with its roof.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _onBeltSet(client, entry) {
        const kind = entry.data.type.beltKind;
        // Added straight; the belt layer re-derives the bend on structural cache changes.
        this._beltLayer.addBelt(entry.id, entry.tileX, entry.tileY, entry.data.direction, kind);
        if (isRamp(kind)) {
            this._addRampMasks(client, entry);
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
        if (isRamp(entry.data.type.beltKind)) {
            this._removeRampMasks(client, id);
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
     * Adds a ramp's item occluders: a roof on its own tile and a threshold strip on the buried neighbor.
     * @param {Client} client
     * @param {CacheEntry} entry
     * @private
     */
    _addRampMasks(client, entry) {
        const kind = entry.data.type.beltKind;
        const direction = entry.data.direction;
        // RAMP_DOWN roofs its up edge (tunnel mouth), RAMP_UP its down edge (where items surface).
        const roofY = kind === BELT_RAMP_UP ? TILE_SIZE - 36 : 0;
        const roof = new Rectangle(0, roofY, TILE_SIZE, 36);
        client.itemLayer.addMask(`roof:${entry.id}`, entry.tileX, entry.tileY, roof, direction);
        const step = tunnelStep(kind, direction);
        // Rotating by the direction back toward the ramp lands the band on the shared edge.
        const edgeDirection = Direction.fromDelta(-step.dx, -step.dy);
        const threshold = new Rectangle(0, 0, TILE_SIZE, TILE_SIZE / 4);
        client.itemLayer.addMask(`threshold:${entry.id}`, entry.tileX + step.dx, entry.tileY + step.dy, threshold, edgeDirection);
    }

    /**
     * Removes a ramp's roof and threshold occluders.
     * @param {Client} client
     * @param {number} id - the ramp's belt id
     * @private
     */
    _removeRampMasks(client, id) {
        client.itemLayer.removeMask(`roof:${id}`);
        client.itemLayer.removeMask(`threshold:${id}`);
    }

    /**
     * Tool-less hover: reveal the buried tunnel under a hovered ramp. Belts draw no highlight.
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
        const ramp = records.find(record => isBeltType(record.data.type) && isRamp(record.data.type.beltKind));
        const tunnel = ramp === undefined ? null : walkTunnel(client.objects, ramp);
        if (tunnel === null) {
            this._overlayLayer.clearUndergroundReveal();
        } else {
            this._overlayLayer.showUndergroundReveal(tunnel.tiles, ramp.data.direction);
        }
        return [];
    }

}
