import {TickPhase} from "@/common/core.js";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {EMPTY, NO_EID} from "@/common/sim/EcsEngine.js";

/**
 * The Splitter mod on the bitECS engine: a 1x2 router of two inputs and two outputs (ports shared
 * with adjacent belts) through two internal buffer ports. Each item flows in_X -> int_X -> out_Y,
 * resting a tick in int_X (belt speed). Submits managed=0 intents so the shared resolver only links
 * the chain; the POST_RESOLVE seam does the moves. All state lives in the registered component, so it
 * serializes with no bespoke save code.
 */
export class SplitterModule {

    /**
     * @param {EcsEngine} engine
     * @param {object} [config]
     * @param {number} [config.typeId] - the single object type this module places
     */
    constructor(engine, {typeId=null}={}) {
        this.engine = engine;
        this.typeId = typeId;

        this.def = engine.defineComponent("Splitter", [
            {name: "in_a", kind: "eid", fill: NO_EID},
            {name: "in_b", kind: "eid", fill: NO_EID},
            {name: "out_a", kind: "eid", fill: NO_EID},
            {name: "out_b", kind: "eid", fill: NO_EID},
            {name: "int_a", kind: "eid", fill: NO_EID},
            {name: "int_b", kind: "eid", fill: NO_EID},
            {name: "state"},
            {name: "clientId", fill: NO_EID},
            {name: "x"},
            {name: "y"},
            {name: "direction"},
            {name: "outATileX"},
            {name: "outATileY"},
            {name: "outBTileX"},
            {name: "outBTileY"},
        ]);
        this.Splitter = this.def.store;

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._runSeam());
        engine.registerRebuildHook(() => this._resync());
    }

    /**
     * The splitter entities.
     * @returns {number[]}
     */
    eids() {
        return this.engine.entitiesWith(this.def);
    }

    /**
     * The placed splitter entity with client id `clientId`, or undefined.
     * @param {number} clientId
     * @returns {number|undefined}
     */
    eidByClientId(clientId) {
        return this.eids().find(eid => this.Splitter.clientId[eid] === clientId);
    }

    /**
     * Creates a splitter, state 0. Ports are fresh unless given in `wiring` (e.g. an upstream belt's
     * out-port reused as in_a, or a downstream belt's in-port reused as out_a).
     * @param {{in_a?:number, in_b?:number, out_a?:number, out_b?:number}} [wiring]
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    addSplitter(wiring={}) {
        const port = given => given === undefined ? this.engine.createPort() : given;
        // Ports first so their eids stay contiguous from 1.
        const in_a = port(wiring.in_a);
        const in_b = port(wiring.in_b);
        const out_a = port(wiring.out_a);
        const out_b = port(wiring.out_b);
        const int_a = this.engine.createPort();
        const int_b = this.engine.createPort();

        const eid = this.engine.createEntity(this.def);
        const S = this.Splitter;
        S.in_a[eid] = in_a;
        S.in_b[eid] = in_b;
        S.out_a[eid] = out_a;
        S.out_b[eid] = out_b;
        S.int_a[eid] = int_a;
        S.int_b[eid] = int_b;
        S.state[eid] = 0;

        return {id: eid, in_a, in_b, out_a, out_b, int_a, int_b};
    }

    /**
     * Places an UP-facing 1x2 splitter at (x, y), adopting the shared edge ports of adjacent belts:
     * in_a/in_b feed from below (the belts at (x,y)/(x+1,y)), out_a/out_b feed the belts above
     * (x,y-1)/(x+1,y-1). Internal ports are private. Rotation for other directions is not done yet.
     * @param {number} x
     * @param {number} y
     * @param {boolean} [client] - whether this is a client-visible splitter (creates a client id +
     *     emits placement); false for sim-only test splitters
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    placeSplitter(x, y, client=false, direction=Direction.UP, ports=null) {
        // Default UP geometry for sim-only placement (tests); a real message placement passes the
        // rotated ports + render tiles from the definition.
        const p = ports === null ? {
            in_a: this.engine.portAt(x, y, Direction.UP),
            in_b: this.engine.portAt(x + 1, y, Direction.UP),
            out_a: this.engine.portAt(x, y - 1, Direction.UP),
            out_b: this.engine.portAt(x + 1, y - 1, Direction.UP),
            outATile: {x, y: y - 1},
            outBTile: {x: x + 1, y: y - 1},
        } : ports;

        const handle = this.addSplitter({in_a: p.in_a, in_b: p.in_b, out_a: p.out_a, out_b: p.out_b});
        if (client) {
            const clientId = this.engine.createObjectId();
            handle.clientId = clientId;
            const S = this.Splitter;
            S.clientId[handle.id] = clientId;
            S.x[handle.id] = x;
            S.y[handle.id] = y;
            S.direction[handle.id] = direction;
            S.outATileX[handle.id] = p.outATile.x;
            S.outATileY[handle.id] = p.outATile.y;
            S.outBTileX[handle.id] = p.outBTile.x;
            S.outBTileY[handle.id] = p.outBTile.y;
            this.engine.registerRenderedPort(handle.out_a, p.outATile.x, p.outATile.y);
            this.engine.registerRenderedPort(handle.out_b, p.outBTile.x, p.outBTile.y);
            this.engine.emitEvent(new EasyObjectInsertEvent(
                this.typeId, clientId, x, y, direction, [handle.out_a, handle.out_b], null,
            ));
        }
        return handle;
    }

    /**
     * The EasyObjectSyncEvents recreating this module's placed splitters in `chunk`.
     * @param {number} chunk
     * @returns {EasyObjectSyncEvent[]}
     */
    chunkSync(chunk) {
        const events = [];
        const S = this.Splitter;
        this.eids().forEach(eid => {
            if (S.clientId[eid] !== NO_EID && chunkId(S.x[eid], S.y[eid]) === chunk) {
                events.push(new EasyObjectSyncEvent(
                    this.typeId, S.clientId[eid], S.x[eid], S.y[eid], S.direction[eid],
                    [S.out_a[eid], S.out_b[eid]], null,
                ));
            }
        });
        return events;
    }

    /**
     * Removes the placed splitter with client id `clientId`, if any.
     * @param {number} clientId
     * @returns {boolean}
     */
    removeSplitterById(clientId) {
        const eid = this.eidByClientId(clientId);
        if (eid === undefined) {
            return false;
        }
        const S = this.Splitter;
        this.engine.unregisterRenderedPort(S.out_a[eid]);
        this.engine.unregisterRenderedPort(S.out_b[eid]);
        this.engine.emitEvent(new EasyObjectDeleteEvent(this.typeId, clientId, S.x[eid], S.y[eid]));
        this.engine.destroyEntity(eid);
        return true;
    }

    /**
     * Re-registers every placed splitter's rendered out-ports after a load repopulates the world.
     * @private
     * @returns {void}
     */
    _resync() {
        const S = this.Splitter;
        this.eids().forEach(eid => {
            if (S.clientId[eid] === NO_EID) {
                return;
            }
            this.engine.registerRenderedPort(S.out_a[eid], S.outATileX[eid], S.outATileY[eid]);
            this.engine.registerRenderedPort(S.out_b[eid], S.outBTileX[eid], S.outBTileY[eid]);
        });
    }

    /**
     * @param {number} eid
     * @returns {number} the splitter's round-robin state bit
     */
    state(eid) {
        return this.Splitter.state[eid];
    }

    /**
     * Stage 1: buffer each loaded input into its internal port (single destination). Stage 2: route
     * each loaded internal port to both outputs as competing fan-out intents, ranked by the
     * round-robin state. All managed=0 — the seam does the moves.
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const item = this.engine.Port.item;
        const S = this.Splitter;
        this.eids().forEach(eid => {
            if (item[S.in_a[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.in_a[eid], dest: S.int_a[eid], destEmpty: item[S.int_a[eid]] === EMPTY, managed: false});
            }
            if (item[S.in_b[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.in_b[eid], dest: S.int_b[eid], destEmpty: item[S.int_b[eid]] === EMPTY, managed: false});
            }
            const preferA = S.state[eid] === 0 ? 1 : 2;
            const preferB = S.state[eid] === 0 ? 2 : 1;
            if (item[S.int_a[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.int_a[eid], dest: S.out_a[eid], destEmpty: item[S.out_a[eid]] === EMPTY, managed: false, rank: preferA});
                this.engine.submitIntent({source: S.int_a[eid], dest: S.out_b[eid], destEmpty: item[S.out_b[eid]] === EMPTY, managed: false, rank: preferB});
            }
            if (item[S.int_b[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.int_b[eid], dest: S.out_b[eid], destEmpty: item[S.out_b[eid]] === EMPTY, managed: false, rank: preferA});
                this.engine.submitIntent({source: S.int_b[eid], dest: S.out_a[eid], destEmpty: item[S.out_a[eid]] === EMPTY, managed: false, rank: preferB});
            }
        });
    }

    /**
     * The POST_RESOLVE seam: record each resolved int->out and in->int hop and its item, clear the
     * drained sources, buffer inputs into internal ports, then write internal ports out — record,
     * clear, fill in that order so items cross at belt speed. Finally advance the round-robin state of
     * every splitter that routed an item.
     * @private
     * @returns {void}
     */
    _runSeam() {
        const item = this.engine.Port.item;
        const S = this.Splitter;
        const stage1 = [];
        const stage2 = [];

        this.eids().forEach(eid => {
            [S.int_a[eid], S.int_b[eid]].forEach(intPort => {
                if (item[intPort] === EMPTY) {
                    return;
                }
                const dest = this.engine.resolvedDestFor(intPort);
                if (dest !== EMPTY) {
                    stage2.push({outPort: dest, item: item[intPort], intPort: intPort});
                }
            });
            [S.in_a[eid], S.in_b[eid]].forEach(inPort => {
                if (item[inPort] === EMPTY) {
                    return;
                }
                const dest = this.engine.resolvedDestFor(inPort);
                if (dest !== EMPTY) {
                    stage1.push({intPort: dest, item: item[inPort], inPort: inPort});
                }
            });
        });

        stage2.forEach(record => {
            item[record.intPort] = EMPTY;
        });
        stage1.forEach(record => {
            item[record.inPort] = EMPTY;
        });
        stage1.forEach(record => {
            item[record.intPort] = record.item;
        });
        stage2.forEach(record => {
            item[record.outPort] = record.item;
        });

        this.eids().forEach(eid => {
            if (this.engine.resolvedDestFor(S.int_a[eid]) !== EMPTY || this.engine.resolvedDestFor(S.int_b[eid]) !== EMPTY) {
                S.state[eid] = 1 - S.state[eid];
            }
        });
    }
}
