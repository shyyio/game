import {EMPTY, NO_EID, Direction, chunkKeyAt, chunkOrigin, tileKeyAt, getOrCreate, removeFromGroup, AbstractSystem} from "@spup/sdk";
import {PIPE_SEGMENT_CAPACITY, DIRECTIONS, joinedFluidType} from "../common/constants.js";
import {
    PipeNetworkRecalculateEvent,
    PipeNetworkBatchEvent,
    PipeFluidSetEvent,
    PipeFluidBatchEvent,
} from "../common/events.js";
import {PipeNetworkComponent} from "./PipeNetworkComponent.js";
import {PipeNetworkMemberComponent} from "./PipeNetworkMemberComponent.js";

/**
 * One same-chunk connected component of pipe tiles, holding a uniform (fluidType, amount).
 */
class PipeNetwork {

    /**
     * @param {number} netId
     * @param {number} chunkKey
     * @param {number} originX
     * @param {number} originY
     * @param {{x:number, y:number, id:number}[]} pipes
     * @param {Set<number>} tiles
     * @param {number} fluidType
     * @param {number} amount
     * @param {number} capacity
     * @param {number[]} inputPorts
     * @param {{x:number, y:number, direction:number, neighborKey:number}[]} outEdges
     */
    constructor(netId, chunkKey, originX, originY, pipes, tiles, fluidType, amount, capacity, inputPorts, outEdges) {
        this.netId = netId;
        this.chunkKey = chunkKey;
        this.originX = originX;
        this.originY = originY;
        this.pipes = pipes;
        this.tiles = tiles;
        this.fluidType = fluidType;
        this.amount = amount;
        this.capacity = capacity;
        this.inputPorts = inputPorts;
        this.outEdges = outEdges;
        // Last state synced to clients, so POST_RESOLVE emits only changes.
        this.lastType = fluidType;
        this.lastAmount = amount;
        // The fluidSourceGeneration this network last rebound its boundary type against.
        this.sourceGen = 0;
    }
}

/**
 * Pipe fluid transport: a network is the same-chunk connected component of pipe tiles (never
 * crossing a seam) holding one uniform (fluidType, amount), so equalization is free. Boundary
 * edges reuse the port-transfer resolver: drain resting payloads at input ports, create one
 * one-unit payload per out-edge port.
 */
export class Pipes extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
        // Placed pipes by tile key and id; one pipe per tile.
        this._pipeByTile = new Map();
        this._pipeById = new Map();
        /**
         * Live networks.
         * @type {PipeNetwork[]}
         */
        this.networks = [];
        // Tile key -> covering network, and chunk -> its networks.
        this._networkByTile = new Map();
        this._networksByChunk = new Map();
        // This tick's emission intents, so POST_RESOLVE decrements only what resolved.
        this._emittedPorts = [];
        this._emittedNets = [];

        // snapshotOnly mirrors of the JS records above, written at save/load.
        this._savedNetworks = engine.components.register(new PipeNetworkComponent());
        this._savedMembers = engine.components.register(new PipeNetworkMemberComponent());

        engine.registerSystem(this);
    }

    /**
     * @returns {number}
     */
    get pipeCount() {
        return this._pipeById.size;
    }

    /**
     * The placed pipe with client-facing `id`, or null.
     * @param {number} id
     * @returns {{x:number, y:number, id:number}|null}
     */
    findPipeById(id) {
        const found = this._pipeById.get(id);
        if (found === undefined) {
            return null;
        }
        return found;
    }

    /**
     * The network covering tile (x, y), or null.
     * @param {number} x
     * @param {number} y
     * @returns {{id:number, fluidType:number, amount:number, capacity:number, size:number}|null}
     */
    findNetworkAt(x, y) {
        const net = this._networkByTile.get(tileKeyAt(x, y));
        if (net === undefined) {
            return null;
        }
        return {id: net.netId, fluidType: net.fluidType, amount: net.amount, capacity: net.capacity, size: net.pipes.length};
    }

    /**
     * Whether a pipe at (x, y) would join at most one fluid type (merged networks plus adopted
     * producer output ports).
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    canJoin(x, y) {
        const chunkKey = chunkKeyAt(x, y);
        return joinedFluidType(direction => {
            const nx = x + Direction.dx(direction);
            const ny = y + Direction.dy(direction);
            const candidates = [];
            if (chunkKeyAt(nx, ny) === chunkKey) {
                const net = this._networkByTile.get(tileKeyAt(nx, ny));
                if (net !== undefined) {
                    candidates.push(net.fluidType);
                }
            }
            const port = this.engine.ports.findPortEidAt(x, y, Direction.invert(direction));
            if (port !== null) {
                candidates.push(this.engine.ports.getFluidSourceByPortEid(port));
            }
            return candidates;
        }) !== null;
    }

    /**
     * Registers a placed pipe, rebuilding its connected component into one network; merged amounts
     * pool, mixed types must be pre-rejected via {@link canJoin}.
     * @param {number} x
     * @param {number} y
     * @param {number} [id] - the pipe's object ref, allocated by the generic spawn path
     * @returns {number} the network id
     */
    placePipe(x, y, id=undefined) {
        const pipe = {x, y, id: id === undefined ? this.engine.createObjectRef() : id};
        this._pipeByTile.set(tileKeyAt(x, y), pipe);
        this._pipeById.set(pipe.id, pipe);

        const component = this._collectComponent(pipe);
        const overlapping = new Set();
        for (const member of component) {
            const held = this._networkByTile.get(tileKeyAt(member.x, member.y));
            if (held !== undefined) {
                overlapping.add(held);
            }
        }
        let amount = 0;
        let fluidType = EMPTY;
        for (const net of overlapping) {
            amount += net.amount;
            if (net.fluidType !== EMPTY) {
                if (fluidType !== EMPTY && fluidType !== net.fluidType) {
                    throw new Error(`Pipe at (${x}, ${y}) merges networks of different fluid types; guard placement with canJoin`);
                }
                fluidType = net.fluidType;
            }
            this._removeNetwork(net);
        }
        if (amount === 0) {
            fluidType = EMPTY;
        }
        const net = this._buildNetwork(component, fluidType, amount);
        this._emitPipeNetworkRecalculate(net);
        this._emitPipeFluidSet(net);
        return net.netId;
    }

    /**
     * Removes the pipe with client-facing `id`, splitting its network; the amount is shared out by
     * component size.
     * @param {number} id
     * @returns {boolean} whether a pipe was removed
     */
    removePipe(id) {
        const pipe = this._pipeById.get(id);
        if (pipe === undefined) {
            return false;
        }
        const net = this._networkByTile.get(tileKeyAt(pipe.x, pipe.y));
        this._removeNetwork(net);
        this._pipeByTile.delete(tileKeyAt(pipe.x, pipe.y));
        this._pipeById.delete(id);

        const covered = new Set();
        const components = [];
        for (const survivor of net.pipes) {
            if (survivor.id === id || covered.has(survivor.id)) {
                continue;
            }
            const component = this._collectComponent(survivor);
            for (const member of component) {
                covered.add(member.id);
            }
            components.push(component);
        }
        if (components.length === 0) {
            return true;
        }

        // Floor shares, remainder wherever capacity is left; total capacity covers the amount.
        const total = net.pipes.length - 1;
        const shares = components.map(component => Math.floor(net.amount * component.length / total));
        let leftover = net.amount - shares.reduce((sum, share) => sum + share, 0);
        for (let i = 0; leftover > 0 && i < components.length; i += 1) {
            const spare = components[i].length * PIPE_SEGMENT_CAPACITY - shares[i];
            const grant = Math.min(spare, leftover);
            shares[i] += grant;
            leftover -= grant;
        }
        for (const [index, component] of components.entries()) {
            let fluidType = net.fluidType;
            if (shares[index] === 0) {
                fluidType = EMPTY;
            }
            const rebuilt = this._buildNetwork(component, fluidType, shares[index]);
            this._emitPipeNetworkRecalculate(rebuilt);
            this._emitPipeFluidSet(rebuilt);
        }
        return true;
    }

    /**
     * Pours fluid into the network at (x, y), clamped to free capacity; for tests/debugging.
     * @param {number} x
     * @param {number} y
     * @param {number} fluidType
     * @param {number} amount
     * @returns {number} the amount added
     */
    addFluid(x, y, fluidType, amount) {
        const net = this._networkByTile.get(tileKeyAt(x, y));
        if (net === undefined) {
            throw new Error(`No pipe network at (${x}, ${y})`);
        }
        if (net.fluidType !== EMPTY && net.fluidType !== fluidType) {
            throw new Error(`Network at (${x}, ${y}) already holds fluid type ${net.fluidType}`);
        }
        const added = Math.min(amount, net.capacity - net.amount);
        if (added > 0) {
            net.amount += added;
            net.fluidType = fluidType;
        }
        return added;
    }

    /**
     * The same-chunk connected component through `pipe`, members ascending by id.
     * @private
     * @param {{x:number, y:number, id:number}} pipe
     * @returns {object[]}
     */
    _collectComponent(pipe) {
        const chunkKey = chunkKeyAt(pipe.x, pipe.y);
        const seen = new Set([tileKeyAt(pipe.x, pipe.y)]);
        const stack = [pipe];
        const component = [];
        while (stack.length > 0) {
            const current = stack.pop();
            component.push(current);
            for (const direction of DIRECTIONS) {
                const nx = current.x + Direction.dx(direction);
                const ny = current.y + Direction.dy(direction);
                const key = tileKeyAt(nx, ny);
                if (seen.has(key) || chunkKeyAt(nx, ny) !== chunkKey) {
                    continue;
                }
                const neighbor = this._pipeByTile.get(key);
                if (neighbor !== undefined) {
                    seen.add(key);
                    stack.push(neighbor);
                }
            }
        }
        return component.sort((a, b) => a.id - b.id);
    }

    /**
     * A new indexed network over `pipes`: input ports created per boundary edge, out-edges resolved
     * lazily each tick; emits nothing.
     * @private
     * @param {object[]} pipes
     * @param {number} fluidType
     * @param {number} amount
     * @returns {PipeNetwork}
     */
    _buildNetwork(pipes, fluidType, amount) {
        const tiles = new Set(pipes.map(pipe => tileKeyAt(pipe.x, pipe.y)));
        const inputPorts = [];
        const outEdges = [];
        for (const pipe of pipes) {
            for (const direction of DIRECTIONS) {
                const nx = pipe.x + Direction.dx(direction);
                const ny = pipe.y + Direction.dy(direction);
                if (tiles.has(tileKeyAt(nx, ny))) {
                    continue;
                }
                const inputPort = this.engine.ports.getPortEidAt(pipe.x, pipe.y, Direction.invert(direction));
                this.engine.ports.markFluid(inputPort);
                inputPorts.push(inputPort);
                outEdges.push({x: nx, y: ny, direction, neighborKey: tileKeyAt(nx, ny)});
            }
        }
        const first = pipes[0];
        const net = new PipeNetwork(
            first.id,
            chunkKeyAt(first.x, first.y),
            first.x,
            first.y,
            pipes,
            tiles,
            fluidType,
            amount,
            pipes.length * PIPE_SEGMENT_CAPACITY,
            inputPorts,
            outEdges,
        );
        this.networks.push(net);
        for (const key of tiles) {
            this._networkByTile.set(key, net);
        }
        getOrCreate(this._networksByChunk, net.chunkKey, () => new Set()).add(net);
        // An adopted producer output port binds the type before the first payload.
        net.sourceGen = this.engine.ports.fluidSourceGeneration;
        if (net.fluidType === EMPTY) {
            const bound = this._getBoundarySourceTypeByNetwork(net);
            net.fluidType = bound;
            net.lastType = bound;
        }
        return net;
    }

    /**
     * The fluid type produced into one of the network's input ports, or EMPTY.
     * @private
     * @param {PipeNetwork} net
     * @returns {number}
     */
    _getBoundarySourceTypeByNetwork(net) {
        for (const port of net.inputPorts) {
            const sourceFluidType = this.engine.ports.getFluidSourceByPortEid(port);
            if (sourceFluidType !== EMPTY) {
                return sourceFluidType;
            }
        }
        return EMPTY;
    }

    /**
     * @private
     * @param {PipeNetwork} net
     * @returns {void}
     */
    _removeNetwork(net) {
        this.networks.splice(this.networks.indexOf(net), 1);
        for (const key of net.tiles) {
            this._networkByTile.delete(key);
        }
        removeFromGroup(this._networksByChunk, net.chunkKey, net);
        for (const port of net.inputPorts) {
            this.engine.ports.unmarkFluid(port);
        }
    }

    /**
     * @private
     * @param {PipeNetwork} net
     * @returns {void}
     */
    _emitPipeNetworkRecalculate(net) {
        this.engine.emitEvent(new PipeNetworkRecalculateEvent(net.originX, net.originY, net.netId, net.pipes.map(pipe => pipe.id)));
    }

    /**
     * @private
     * @param {PipeNetwork} net
     * @returns {void}
     */
    _emitPipeFluidSet(net) {
        this.engine.emitEvent(new PipeFluidSetEvent(net.originX, net.originY, net.netId, net.fluidType, net.amount));
    }

    /**
     * The port eids the live networks still reference, so the engine's port sweep keeps them.
     * @private
     * @returns {number[]}
     */
    getPinnedPortEids() {
        const ports = [];
        for (const net of this.networks) {
            for (const port of net.inputPorts) {
                ports.push(port);
            }
        }
        return ports;
    }

    /**
     * SUBMIT_INTENTS: drain type-matching payloads at input ports (a mismatch backs up), then create
     * one payload per out-edge port, capped by amount; seams push only strictly downhill into a
     * free or same-type network.
     * @private
     * @returns {void}
     */
    submitIntents() {
        const engine = this.engine;
        const P = engine.Port.item;
        this._emittedPorts.length = 0;
        this._emittedNets.length = 0;
        for (const net of this.networks) {
            for (const port of net.inputPorts) {
                const resting = P[port];
                if (resting === EMPTY || net.amount === net.capacity) {
                    continue;
                }
                if (net.fluidType !== EMPTY && resting !== net.fluidType) {
                    continue;
                }
                engine.transfers.submitDrain(port);
                net.fluidType = resting;
                net.amount += 1;
            }

            let budget = net.amount;
            if (budget === 0) {
                continue;
            }
            for (const edge of net.outEdges) {
                if (budget === 0) {
                    break;
                }
                // Only fluid-flagged ports receive payloads.
                const destPortEid = engine.ports.findPortEidAt(edge.x, edge.y, edge.direction);
                if (destPortEid === null || !engine.ports.isFluidClaimed(destPortEid)) {
                    continue;
                }
                const neighborNet = this._networkByTile.get(edge.neighborKey);
                if (neighborNet !== undefined) {
                    if (neighborNet.fluidType !== EMPTY && neighborNet.fluidType !== net.fluidType) {
                        continue;
                    }
                    if (net.amount * neighborNet.capacity <= neighborNet.amount * net.capacity) {
                        continue;
                    }
                }
                engine.transfers.submitCreate(destPortEid, net.fluidType, P[destPortEid] === EMPTY);
                this._emittedPorts.push(destPortEid);
                this._emittedNets.push(net);
                budget -= 1;
            }
        }
    }

    /**
     * POST_RESOLVE: debit each resolved emission, clear a drained network's type, and batch the
     * changed fluid states per subscribed chunk.
     * @private
     * @returns {void}
     */
    postResolve() {
        const engine = this.engine;
        for (let i = 0; i < this._emittedPorts.length; i += 1) {
            if (engine.transfers.isDest(this._emittedPorts[i])) {
                this._emittedNets[i].amount -= 1;
            }
        }
        const batches = new Map();
        const sourceGen = engine.ports.fluidSourceGeneration;
        for (const net of this.networks) {
            // A drained network re-binds to a connected producer's type (EMPTY when none) — only
            // when just drained or a source changed, so idle networks skip the port scan.
            if (net.amount === 0 && (net.lastAmount !== 0 || net.sourceGen !== sourceGen)) {
                net.fluidType = this._getBoundarySourceTypeByNetwork(net);
                net.sourceGen = sourceGen;
            }
            if (net.fluidType === net.lastType && net.amount === net.lastAmount) {
                continue;
            }
            net.lastType = net.fluidType;
            net.lastAmount = net.amount;
            if (!engine.isTileSubscribed(net.originX, net.originY)) {
                continue;
            }
            const batch = getOrCreate(batches, net.chunkKey, () => new PipeFluidBatchEvent(net.originX, net.originY));
            batch.add(net.netId, net.fluidType, net.amount);
        }
        for (const batch of batches.values()) {
            engine.emitEvent(batch);
        }
    }

    /**
     * The events recreating `chunk`'s networks and fluid state for a just-subscribed session.
     * @param {number} chunkKey
     * @returns {object[]}
     */
    chunkSync(chunkKey) {
        const nets = this._networksByChunk.get(chunkKey);
        if (nets === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunkKey);
        let topology = null;
        let fluid = null;
        for (const net of nets) {
            if (topology === null) {
                topology = new PipeNetworkBatchEvent(origin.x, origin.y);
            }
            topology.add(net.netId, net.pipes.map(pipe => pipe.id));
            if (net.amount > 0) {
                if (fluid === null) {
                    fluid = new PipeFluidBatchEvent(net.originX, net.originY);
                }
                fluid.add(net.netId, net.fluidType, net.amount);
            }
        }
        // Topology before fluid: the client fans fluid state out over the membership.
        return [topology, fluid].filter(batch => batch !== null);
    }

    /**
     * Serialize hook: flushes the JS network runtime into the snapshot components, clearing prior
     * save entities.
     * @private
     * @returns {void}
     */
    serialize() {
        for (const component of [this._savedMembers, this._savedNetworks]) {
            for (const eid of component.getLiveEids()) {
                this.engine.components.destroyEntity(eid);
            }
        }
        const N = this._savedNetworks.store;
        const M = this._savedMembers.store;
        for (const net of this.networks) {
            const netEid = this._savedNetworks.create();
            N.fluidType[netEid] = net.fluidType;
            N.amount[netEid] = net.amount;
            for (const pipe of net.pipes) {
                const memberEid = this._savedMembers.create();
                M.network[memberEid] = netEid;
                M.objectRef[memberEid] = pipe.id;
            }
        }
    }

    /**
     * Clears the pipe indexes ahead of a rebuild; pipes re-register before the network hook re-links.
     * @returns {void}
     */
    resetPipes() {
        this._pipeByTile = new Map();
        this._pipeById = new Map();
    }

    /**
     * Re-registers one placed pipe after a load.
     * @param {{x:number, y:number, id:number}} pipe
     * @returns {void}
     */
    registerPipe(pipe) {
        this._pipeByTile.set(tileKeyAt(pipe.x, pipe.y), pipe);
        this._pipeById.set(pipe.id, pipe);
    }

    /**
     * Rebuild hook: re-links each network from the snapshot components over the re-registered pipes.
     * @private
     * @returns {void}
     */
    rebuild() {
        this.networks = [];
        this._networkByTile = new Map();
        this._networksByChunk = new Map();

        const N = this._savedNetworks.store;
        const M = this._savedMembers.store;
        const membersByNet = new Map();
        for (const eid of this._savedMembers.getLiveEids()) {
            const pipe = this.findPipeById(M.objectRef[eid]);
            if (pipe === null) {
                throw new Error(`PipeNetworkMember references unknown pipe ${M.objectRef[eid]}`);
            }
            getOrCreate(membersByNet, M.network[eid], () => []).push(pipe);
        }
        for (const netEid of this._savedNetworks.getLiveEids()) {
            const pipes = membersByNet.get(netEid);
            if (pipes === undefined) {
                throw new Error(`PipeNetwork entity ${netEid} has no members`);
            }
            // A loadout change empties the type column and leaves the amount; untyped is empty.
            const amount = N.fluidType[netEid] === EMPTY ? 0 : N.amount[netEid];
            this._buildNetwork(pipes.sort((a, b) => a.id - b.id), N.fluidType[netEid], amount);
        }
    }
}
