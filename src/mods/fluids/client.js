import {AbstractClientMod, EMPTY, Direction, chunkId} from "@spup/sdk/client";
import {PipeFluidDrawLayer} from "./client/PipeFluidDrawLayer.js";
import {NetworkDebugDrawLayer} from "./client/NetworkDebugDrawLayer.js";
import {isPipeType, isTankType, PipeDefinition} from "./common/objectTypes.js";
import {PIPE_SEGMENT_CAPACITY, joinedFluidType} from "./common/constants.js";
import {PipeNetworkRecalculateEvent, PipeFluidSetEvent, TankFluidSetEvent} from "./common/events.js";

export class FluidsClientMod extends AbstractClientMod {

    constructor() {
        super();
        // Driven imperatively by onEvent.
        this._fluidLayer = new PipeFluidDrawLayer();
        // Network id -> member pipe ids.
        this._networkParts = new Map();
        // Inverse map, so a removed pipe cleans its network's tracking.
        this._pipeToNetwork = new Map();
        // Network id -> {fluidType, amount}.
        this._fluidByNetwork = new Map();
        // Tank object id -> held fluid type, from the tank fluid deltas.
        this._fluidByTank = new Map();
        // Debug overlay of network membership and fill.
        this._debugLayer = new NetworkDebugDrawLayer(this._networkParts, this._fluidByNetwork, PIPE_SEGMENT_CAPACITY);
    }

    drawLayers(client) {
        return [this._fluidLayer, this._debugLayer];
    }

    setup(client) {
        client.objects.onRemove(entry => {
            if (isPipeType(entry.data.type)) {
                this._onPipeRemoved(entry.id);
            }
            if (isTankType(entry.data.type)) {
                this._fluidByTank.delete(entry.id);
            }
        });
    }

    /**
     * Single client-side hub for the pipe network/fluid events.
     * @param {AbstractEvent} event
     * @param {Client} client
     */
    onEvent(event, client) {
        if (event instanceof PipeNetworkRecalculateEvent) {
            this._updateNetwork(event.networkId, event.parts);
            this._debugLayer.markStale();
            return;
        }
        if (event instanceof PipeFluidSetEvent) {
            this._fluidByNetwork.set(event.networkId, {fluidType: event.fluidType, amount: event.amount});
            this._repaintNetwork(event.networkId);
            this._debugLayer.markStale();
            return;
        }
        if (event instanceof TankFluidSetEvent) {
            this._fluidByTank.set(event.objectId, event.fluidType);
        }
    }

    /**
     * Mirrors Pipes.canJoin: a pipe may not bridge different fluid types.
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {Client} client
     * @returns {boolean}
     */
    canPlace(type, tileX, tileY, direction, client) {
        if (!isPipeType(type)) {
            return true;
        }
        const chunk = chunkId(tileX, tileY);
        return joinedFluidType(neighborDirection => {
            const nx = tileX + Direction.dx(neighborDirection);
            const ny = tileY + Direction.dy(neighborDirection);
            const candidates = [];
            if (chunkId(nx, ny) === chunk) {
                const pipe = client.objects.objectAt(nx, ny, PipeDefinition);
                if (pipe !== null) {
                    candidates.push(this._networkFluidType(pipe.id));
                }
            }
            const feeder = client.objects.outPortAt(tileX, tileY, Direction.invert(neighborDirection));
            if (feeder !== null) {
                candidates.push(this._producedFluidType(client, feeder.entry.id));
            }
            return candidates;
        }) !== null;
    }

    /**
     * The fluid type bound to a cached pipe's network, or EMPTY.
     * @private
     * @param {number} pipeId
     * @returns {number}
     */
    _networkFluidType(pipeId) {
        const networkId = this._pipeToNetwork.get(pipeId);
        if (networkId === undefined) {
            return EMPTY;
        }
        const fluid = this._fluidByNetwork.get(networkId);
        if (fluid === undefined) {
            return EMPTY;
        }
        return fluid.fluidType;
    }

    /**
     * The fluid an object's out-port produces, or EMPTY: tank live content, else last output.
     * @private
     * @param {Client} client
     * @param {number} objectId
     * @returns {number}
     */
    _producedFluidType(client, objectId) {
        const tankFluid = this._fluidByTank.get(objectId);
        if (tankFluid !== undefined) {
            return tankFluid;
        }
        const product = client.objects.lastProducedOf(objectId);
        if (product === undefined || !client.modRegistry.fluidTypes.has(product)) {
            return EMPTY;
        }
        return product;
    }

    /**
     * Records a recalculated network, dropping any network id a merge absorbed.
     * @private
     * @param {number} networkId
     * @param {number[]} parts - member pipe ids
     * @returns {void}
     */
    _updateNetwork(networkId, parts) {
        for (const id of parts) {
            const previous = this._pipeToNetwork.get(id);
            if (previous !== undefined && previous !== networkId) {
                this._networkParts.delete(previous);
                this._fluidByNetwork.delete(previous);
            }
            this._pipeToNetwork.set(id, networkId);
        }
        this._networkParts.set(networkId, parts);
        this._repaintNetwork(networkId);
    }

    /**
     * Fans a network's fluid state out to every member tile's fill.
     * @private
     * @param {number} networkId
     * @returns {void}
     */
    _repaintNetwork(networkId) {
        const parts = this._networkParts.get(networkId);
        if (parts === undefined) {
            return;
        }
        const fluid = this._fluidByNetwork.get(networkId);
        let fluidType = EMPTY;
        let fraction = 0;
        if (fluid !== undefined && fluid.amount > 0) {
            fluidType = fluid.fluidType;
            fraction = fluid.amount / (parts.length * PIPE_SEGMENT_CAPACITY);
        }
        for (const id of parts) {
            this._fluidLayer.setFluid(id, fluidType, fraction);
        }
    }

    /**
     * Drops a removed pipe's tracking; survivors re-register through their recalc events, which
     * precede the removal and already exclude the pipe.
     * @private
     * @param {number} id
     * @returns {void}
     */
    _onPipeRemoved(id) {
        const networkId = this._pipeToNetwork.get(id);
        this._pipeToNetwork.delete(id);
        // Only a fully dissolved network (the removed pipe held its id, no survivors recalced)
        // leaves stale tracking behind.
        if (networkId === id) {
            this._networkParts.delete(id);
            this._fluidByNetwork.delete(id);
        }
    }
}
