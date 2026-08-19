import {TickPhase, EMPTY, NO_EID, Direction, chunkId, chunkOrigin, tileId, getOrCreate, removeFromGroup} from "@spup/sdk";
import {PIPE_SEGMENT_CAPACITY, DIRECTIONS, joinedFluidType} from "../common/constants.js";
import {
    PipeNetworkRecalculateEvent,
    PipeNetworkBatchEvent,
    PipeFluidSetEvent,
    PipeFluidBatchEvent,
} from "../common/events.js";

/**
 * One same-chunk connected component of pipe tiles, holding a uniform (fluidType, amount).
 */
class PipeNetwork {

    /**
     * @param {number} netId
     * @param {number} chunk
     * @param {number} originX
     * @param {number} originY
     * @param {{x:number, y:number, id:number}[]} pipes
     * @param {Set<number>} tiles
     * @param {number} fluidType
     * @param {number} amount
     * @param {number} capacity
     * @param {number[]} inPorts
     * @param {{x:number, y:number, direction:number, neighborKey:number}[]} outEdges
     */
    constructor(netId, chunk, originX, originY, pipes, tiles, fluidType, amount, capacity, inPorts, outEdges) {
        this.netId = netId;
        this.chunk = chunk;
        this.originX = originX;
        this.originY = originY;
        this.pipes = pipes;
        this.tiles = tiles;
        this.fluidType = fluidType;
        this.amount = amount;
        this.capacity = capacity;
        this.inPorts = inPorts;
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
 * edges reuse the port-transfer resolver: drain resting payloads at in-ports, create one
 * one-unit payload per out-edge port.
 */
export class Pipes {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
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
        this._netDef = engine.defineComponent("PipeNetwork", [
            {name: "fluidType", fill: EMPTY},
            {name: "amount"},
        ], {snapshotOnly: true});
        this._memberDef = engine.defineComponent("PipeNetworkMember", [
            {name: "network", kind: "eid", fill: NO_EID},
            {name: "objectId", fill: NO_EID},
        ], {snapshotOnly: true});

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._apply());
        engine.registerSerializeHook(() => this._materialize());
        engine.registerRebuildHook(() => this._reconstruct());
        engine.registerPortPin(() => this._pinnedPorts());
        engine.registerChunkSync(chunk => this.chunkSync(chunk));
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
    pipeById(id) {
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
    networkAt(x, y) {
        const net = this._networkByTile.get(tileId(x, y));
        if (net === undefined) {
            return null;
        }
        return {id: net.netId, fluidType: net.fluidType, amount: net.amount, capacity: net.capacity, size: net.pipes.length};
    }

    /**
     * Whether a pipe at (x, y) would join at most one fluid type (merged networks plus adopted
     * producer out-ports).
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    canJoin(x, y) {
        const chunk = chunkId(x, y);
        return joinedFluidType(direction => {
            const nx = x + Direction.dx(direction);
            const ny = y + Direction.dy(direction);
            const candidates = [];
            if (chunkId(nx, ny) === chunk) {
                const net = this._networkByTile.get(tileId(nx, ny));
                if (net !== undefined) {
                    candidates.push(net.fluidType);
                }
            }
            const port = this.engine.peekPortAt(x, y, Direction.invert(direction));
            if (port !== null) {
                candidates.push(this.engine.portFluidSource(port));
            }
            return candidates;
        }) !== null;
    }

    /**
     * Registers a placed pipe, rebuilding its connected component into one network; merged amounts
     * pool, mixed types must be pre-rejected via {@link canJoin}.
     * @param {number} x
     * @param {number} y
     * @param {number} [id] - the pipe's object id, allocated by the generic spawn path
     * @returns {number} the network id
     */
    placePipe(x, y, id=undefined) {
        const pipe = {x, y, id: id === undefined ? this.engine.createObjectId() : id};
        this._pipeByTile.set(tileId(x, y), pipe);
        this._pipeById.set(pipe.id, pipe);

        const component = this._collectComponent(pipe);
        const overlapping = new Set();
        for (const member of component) {
            const held = this._networkByTile.get(tileId(member.x, member.y));
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
            this._dropNetwork(net);
        }
        if (amount === 0) {
            fluidType = EMPTY;
        }
        const net = this._buildNetwork(component, fluidType, amount);
        this._emitNetworkEvents(net);
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
        const net = this._networkByTile.get(tileId(pipe.x, pipe.y));
        this._dropNetwork(net);
        this._pipeByTile.delete(tileId(pipe.x, pipe.y));
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
            this._emitNetworkEvents(rebuilt);
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
        const net = this._networkByTile.get(tileId(x, y));
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
        const chunk = chunkId(pipe.x, pipe.y);
        const seen = new Set([tileId(pipe.x, pipe.y)]);
        const stack = [pipe];
        const component = [];
        while (stack.length > 0) {
            const current = stack.pop();
            component.push(current);
            for (const direction of DIRECTIONS) {
                const nx = current.x + Direction.dx(direction);
                const ny = current.y + Direction.dy(direction);
                const key = tileId(nx, ny);
                if (seen.has(key) || chunkId(nx, ny) !== chunk) {
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
     * A new indexed network over `pipes`: in-ports created per boundary edge, out-edges resolved
     * lazily each tick; emits nothing.
     * @private
     * @param {object[]} pipes
     * @param {number} fluidType
     * @param {number} amount
     * @returns {PipeNetwork}
     */
    _buildNetwork(pipes, fluidType, amount) {
        const tiles = new Set(pipes.map(pipe => tileId(pipe.x, pipe.y)));
        const inPorts = [];
        const outEdges = [];
        for (const pipe of pipes) {
            for (const direction of DIRECTIONS) {
                const nx = pipe.x + Direction.dx(direction);
                const ny = pipe.y + Direction.dy(direction);
                if (tiles.has(tileId(nx, ny))) {
                    continue;
                }
                const inPort = this.engine.portAt(pipe.x, pipe.y, Direction.invert(direction));
                this.engine.markFluidPort(inPort);
                inPorts.push(inPort);
                outEdges.push({x: nx, y: ny, direction, neighborKey: tileId(nx, ny)});
            }
        }
        const first = pipes[0];
        const net = new PipeNetwork(
            first.id,
            chunkId(first.x, first.y),
            first.x,
            first.y,
            pipes,
            tiles,
            fluidType,
            amount,
            pipes.length * PIPE_SEGMENT_CAPACITY,
            inPorts,
            outEdges,
        );
        this.networks.push(net);
        for (const key of tiles) {
            this._networkByTile.set(key, net);
        }
        getOrCreate(this._networksByChunk, net.chunk, () => new Set()).add(net);
        // An adopted producer out-port binds the type before the first payload.
        net.sourceGen = this.engine.fluidSourceGeneration;
        if (net.fluidType === EMPTY) {
            const bound = this._boundarySourceType(net);
            net.fluidType = bound;
            net.lastType = bound;
        }
        return net;
    }

    /**
     * The fluid type produced into one of the network's in-ports, or EMPTY.
     * @private
     * @param {PipeNetwork} net
     * @returns {number}
     */
    _boundarySourceType(net) {
        for (const port of net.inPorts) {
            const source = this.engine.portFluidSource(port);
            if (source !== EMPTY) {
                return source;
            }
        }
        return EMPTY;
    }

    /**
     * @private
     * @param {PipeNetwork} net
     * @returns {void}
     */
    _dropNetwork(net) {
        this.networks.splice(this.networks.indexOf(net), 1);
        for (const key of net.tiles) {
            this._networkByTile.delete(key);
        }
        removeFromGroup(this._networksByChunk, net.chunk, net);
        for (const port of net.inPorts) {
            this.engine.unmarkFluidPort(port);
        }
    }

    /**
     * @private
     * @param {PipeNetwork} net
     * @returns {void}
     */
    _emitNetworkEvents(net) {
        this.engine.emitEvent(new PipeNetworkRecalculateEvent(net.originX, net.originY, net.netId, net.pipes.map(pipe => pipe.id)));
        this.engine.emitEvent(new PipeFluidSetEvent(net.originX, net.originY, net.netId, net.fluidType, net.amount));
    }

    /**
     * The port eids the live networks still reference, so the engine's port sweep keeps them.
     * @private
     * @returns {number[]}
     */
    _pinnedPorts() {
        const ports = [];
        for (const net of this.networks) {
            for (const port of net.inPorts) {
                ports.push(port);
            }
        }
        return ports;
    }

    /**
     * SUBMIT_INTENTS: drain type-matching payloads at in-ports (a mismatch backs up), then create
     * one payload per out-edge port, capped by amount; seams push only strictly downhill into a
     * free or same-type network.
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const engine = this.engine;
        const P = engine.Port.item;
        this._emittedPorts.length = 0;
        this._emittedNets.length = 0;
        for (const net of this.networks) {
            for (const port of net.inPorts) {
                const resting = P[port];
                if (resting === EMPTY || net.amount === net.capacity) {
                    continue;
                }
                if (net.fluidType !== EMPTY && resting !== net.fluidType) {
                    continue;
                }
                engine.submitDrain(port, true);
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
                const dest = engine.peekPortAt(edge.x, edge.y, edge.direction);
                if (dest === null || !engine.isFluidPort(dest)) {
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
                engine.submitCreate(dest, net.fluidType, P[dest] === EMPTY);
                this._emittedPorts.push(dest);
                this._emittedNets.push(net);
                budget -= 1;
            }
        }
    }

    /**
     * POST_RESOLVE: debit each resolved emission, clear a drained network's type, and batch the
     * changed fluid states per observed chunk.
     * @private
     * @returns {void}
     */
    _apply() {
        const engine = this.engine;
        for (let i = 0; i < this._emittedPorts.length; i += 1) {
            if (engine.wasResolvedDest(this._emittedPorts[i])) {
                this._emittedNets[i].amount -= 1;
            }
        }
        const batches = new Map();
        const sourceGen = engine.fluidSourceGeneration;
        for (const net of this.networks) {
            // A drained network re-binds to a connected producer's type (EMPTY when none) — only
            // when just drained or a source changed, so idle networks skip the port scan.
            if (net.amount === 0 && (net.lastAmount !== 0 || net.sourceGen !== sourceGen)) {
                net.fluidType = this._boundarySourceType(net);
                net.sourceGen = sourceGen;
            }
            if (net.fluidType === net.lastType && net.amount === net.lastAmount) {
                continue;
            }
            net.lastType = net.fluidType;
            net.lastAmount = net.amount;
            if (!engine.observesTile(net.originX, net.originY)) {
                continue;
            }
            const batch = getOrCreate(batches, net.chunk, () => new PipeFluidBatchEvent(net.originX, net.originY));
            batch.add(net.netId, net.fluidType, net.amount);
        }
        for (const batch of batches.values()) {
            engine.emitEvent(batch);
        }
    }

    /**
     * The events recreating `chunk`'s networks and fluid state for a just-subscribed session.
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        const nets = this._networksByChunk.get(chunk);
        if (nets === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunk);
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
    _materialize() {
        for (const def of [this._memberDef, this._netDef]) {
            for (const eid of this.engine.entitiesWith(def)) {
                this.engine.destroyEntity(eid);
            }
        }
        const N = this._netDef.store;
        const M = this._memberDef.store;
        for (const net of this.networks) {
            const netEid = this.engine.createEntity(this._netDef);
            N.fluidType[netEid] = net.fluidType;
            N.amount[netEid] = net.amount;
            for (const pipe of net.pipes) {
                const memberEid = this.engine.createEntity(this._memberDef);
                M.network[memberEid] = netEid;
                M.objectId[memberEid] = pipe.id;
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
        this._pipeByTile.set(tileId(pipe.x, pipe.y), pipe);
        this._pipeById.set(pipe.id, pipe);
    }

    /**
     * Rebuild hook: re-links each network from the snapshot components over the re-registered pipes.
     * @private
     * @returns {void}
     */
    _reconstruct() {
        this.networks = [];
        this._networkByTile = new Map();
        this._networksByChunk = new Map();

        const N = this._netDef.store;
        const M = this._memberDef.store;
        const membersByNet = new Map();
        for (const eid of this.engine.entitiesWith(this._memberDef)) {
            const pipe = this.pipeById(M.objectId[eid]);
            if (pipe === null) {
                throw new Error(`PipeNetworkMember references unknown pipe ${M.objectId[eid]}`);
            }
            getOrCreate(membersByNet, M.network[eid], () => []).push(pipe);
        }
        for (const netEid of this.engine.entitiesWith(this._netDef)) {
            const pipes = membersByNet.get(netEid);
            if (pipes === undefined) {
                throw new Error(`PipeNetwork entity ${netEid} has no members`);
            }
            this._buildNetwork(pipes.sort((a, b) => a.id - b.id), N.fluidType[netEid], N.amount[netEid]);
        }
    }
}
