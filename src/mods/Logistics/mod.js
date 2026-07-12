import {
    AbstractMod,
    EasyObjectPlacement,
    chunkId,
    CHUNK_SIZE,
    upstreamPorts,
    downstreamPorts,
    Direction,
    PlacementRejected,
    BufferedEvent,
    DeleteObjectMessage,
    CreateObjectMessage,
} from "@/sdk/common.js";
import {CreateBeltMessage} from "./messages.js";
import {BeltModule} from "./BeltModule.js";
import {SplitterModule} from "@/common/sim/SplitterSystems.js";
import {
    BELT_NORMAL,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    MAX_UNDERGROUND_LENGTH,
    BUFFERED_EVENT_TYPE_ITEM_RESET,
    BUFFERED_EVENT_TYPE_ITEM_SYNC,
} from "./constants.js";
import {getUndergroundBeltsToCreate, isRamp, tunnelStep, beltOccupancyLayer} from "./geometry.js";
import {beltSchema, beltTempSchema} from "./schema.js";
import {BeltDefinition, SplitterDefinition} from "./definitions.js";
import {beltStatements} from "./statements.js";
import {
    BeltPathRecalculateEvent,
    BeltInsertEvent,
    BeltDeleteEvent,
    BeltSyncEvent,
} from "./events.js";

export class LogisticsMod extends AbstractMod {

    constructor() {
        super();
        // The splitter is a plain port-sharing object; the engine handles its place/remove/sync.
        // Belts themselves stay bespoke (paths, undergrounds, recalc).
        this._splitterPlacement = new EasyObjectPlacement(SplitterDefinition);
    }

    get wireClasses() {
        return [
            CreateBeltMessage,
            BeltInsertEvent,
            BeltDeleteEvent,
            BeltPathRecalculateEvent,
            BeltSyncEvent,
        ];
    }

    get schema() {
        return beltSchema;
    }

    get definitions() {
        return {[BeltDefinition.table]: BeltDefinition, [SplitterDefinition.table]: SplitterDefinition};
    }

    get tempSchema() {
        return beltTempSchema;
    }

    get extraStatements() {
        return [...beltStatements, ...this._splitterPlacement.statements];
    }

    // ---- Chunk sync ----

    /**
     * Sync events for a synced chunk: a BeltSyncEvent per belt (undergrounds included,
     * for the client's ramp scans) then a BeltPathRecalculateEvent per path it touches.
     * @param {number} chunk
     * @returns {AbstractTilePositionedEvent[]}
     */
    chunkSyncEvents(chunk) {
        // Re-sync this chunk's paths' items to the subscribing viewport next tick.
        this.game.exec("MarkChunkPathsForResync", {chunk});
        const belts = this.game.query("GetBeltsInChunk", {chunk});
        const events = [];
        const paths = new Map();
        belts.forEach(belt => {
            events.push(new BeltSyncEvent(
                belt.x,
                belt.y,
                belt.id,
                belt.direction,
                belt.type,
                belt.parent_x,
                belt.parent_y,
            ));
            // Group the chunk's belts into their paths to sync the path-debug overlay.
            let path = paths.get(belt.path_id);
            if (path === undefined) {
                path = {parts: []};
                paths.set(belt.path_id, path);
            }
            path.parts.push(belt.id);
            // Belts arrive head-last, so the final write leaves the head's position.
            path.x = belt.x;
            path.y = belt.y;
        });

        // The belt syncs above all come first, so the client's belt cache holds every
        // position before each path recalc is replayed.
        paths.forEach(path => {
            const head = path.parts[path.parts.length - 1];
            const outPortId = this.game.queryScalar("GetPathOutPort", {id: head});
            events.push(new BeltPathRecalculateEvent(path.x, path.y, path.parts, outPortId));
        });

        this._splitterPlacement.chunkSyncEvents(this.game, chunk).forEach(event => events.push(event));

        return events;
    }

    // ---- AbstractMessage handling ----

    onMessage(message) {
        // The splitter's place/remove is engine-handled; belts are bespoke.
        this._splitterPlacement.handleMessage(this.game, message);
        if (message instanceof CreateBeltMessage) {
            this._createBelt({
                x: message.x,
                y: message.y,
                direction: message.direction,
                type: message.beltType,
                rampParent: message.rampParent,
                disconnectRampChild: message.disconnectRampChild,
            });
        } else if (message instanceof DeleteObjectMessage) {
            this._deleteObject(message.id);
        }
    }

    /**
     * Registers the belt + splitter ECS modules and their message/chunk-sync handlers.
     * @param {EcsSimEngine} sim
     * @returns {void}
     */
    setupEcs(sim) {
        // Splitter before belt so its POST_RESOLVE seam reads shared ports before the belt writes pops.
        sim.splitter = new SplitterModule(sim.engine);
        sim.belts = new BeltModule(sim.engine);
        sim.registerMessageHandler(message => this._ecsBeltMessage(sim, message));
        sim.registerMessageHandler(message => this._ecsSplitterMessage(sim, message));
        sim.registerChunkSync(chunk => sim.belts.chunkSync(chunk));
        sim.registerChunkSync(chunk => sim.splitter.chunkSync(chunk));
    }

    /**
     * @private
     * @param {EcsSimEngine} sim
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _ecsBeltMessage(sim, message) {
        if (message instanceof CreateBeltMessage) {
            const type = message.beltType === null || message.beltType === undefined ? BELT_NORMAL : message.beltType;
            // A ramp-up paired to a ramp-down fills the span with undergrounds first, so the whole
            // tunnel collects into one path.
            if (type === BELT_RAMP_UP && message.rampParent !== null && message.rampParent !== undefined) {
                const rampDown = sim.belts.beltById(message.rampParent);
                if (rampDown !== null) {
                    const span = getUndergroundBeltsToCreate(rampDown, {
                        x: message.x, y: message.y, direction: message.direction, type: BELT_RAMP_UP,
                    });
                    span.forEach(cell => sim.belts.placeBelt(cell.x, cell.y, message.direction, BELT_UNDERGROUND));
                }
            }
            sim.belts.placeBelt(message.x, message.y, message.direction, type);
            return true;
        }
        if (message instanceof DeleteObjectMessage) {
            return sim.belts.removeBeltById(message.id) || sim.splitter.removeSplitterById(message.id);
        }
        return false;
    }

    /**
     * @private
     * @param {EcsSimEngine} sim
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _ecsSplitterMessage(sim, message) {
        if (!(message instanceof CreateObjectMessage) || message.typeId !== SplitterDefinition.typeId) {
            return false;
        }
        const d = message.direction;
        const footprint = sim.footprint(SplitterDefinition, message.x, message.y, d);
        if (!sim.occupancyFree(footprint)) {
            return true;
        }
        const inA = sim.portFor(SplitterDefinition.inputPorts[0], message.x, message.y, d);
        const inB = sim.portFor(SplitterDefinition.inputPorts[1], message.x, message.y, d);
        const outA = sim.portFor(SplitterDefinition.outputPorts[0], message.x, message.y, d);
        const outB = sim.portFor(SplitterDefinition.outputPorts[1], message.x, message.y, d);
        const handle = sim.splitter.placeSplitter(message.x, message.y, message.typeId, d, {
            in_a: inA.port, in_b: inB.port, out_a: outA.port, out_b: outB.port,
            outATile: outA.tile, outBTile: outB.tile,
        });
        sim.track(handle.clientId, footprint);
        return true;
    }

    /**
     * Removes the belt with this id if it's one of ours; ignores ids belonging to no belt (the
     * generic delete is broadcast to every mod, and the splitter placement handles its own).
     * @private
     * @param {BigInt} id
     */
    _deleteObject(id) {
        if (this.game.querySingle("GetBelt", {id}) !== null) {
            this._removeBelt(id);
        }
    }

    // ---- Belt creation ----

    /**
     * Places one belt and rewires the affected paths around it.
     * @private
     * @param {{x: number, y: number, type: number, direction: Direction, [rampParent]: BigInt, [disconnectRampChild]: BigInt, [chunk]: number}} options
     * @param {boolean} [transaction] - false when called recursively, so only the outermost call owns the begin/end boundary
     */
    _createBelt(options, transaction=true) {
        options.chunk = chunkId(options.x, options.y);
        if (transaction) {
            this.game.begin();
            this._resyncHeads = new Set();
            // A ramp disconnect here removes belts (recursively), which may add orphaned
            // heads; the create rewire that follows re-links them, so it's never drained.
            this._orphanedHeads = new Set();
        }

        try {
            if (options.disconnectRampChild) {
                this._disconnectRampChain(options);
            }
            if (options.rampParent && isRamp(options.type)) {
                this._createUndergrounds(options);
            }

            const id = this._insertBelt(options);
            const {head, child} = this._resolveCreateContext(id, options);

            if (this._isStandaloneChildMerge(id, head, child)) {
                this._mergeStandaloneChild(id, head, child, options);
            } else {
                this._rebuildPaths(id, head, child, options);
            }
        } catch (e) {
            // Only the transaction owner unwinds: a nested create (an underground laid
            // for a ramp) rethrows so the owner rolls back exactly once.
            if (!transaction) {
                throw e;
            }
            this.game.rollback();
            if (e instanceof PlacementRejected) {
                return;
            }
            throw e;
        }

        if (transaction) {
            this._flushItemResync();
            this.game.end();
        }
    }

    /**
     * Inserts the Belt row and returns its id, throwing PlacementRejected on a placement
     * conflict (the transaction owner in _createBelt rolls back).
     * @private
     * @param {{x: number, y: number, type: number, direction: Direction}} options
     * @returns {BigInt}
     */
    _insertBelt(options) {
        // Reject a tile already occupied on this belt's layer (a surface object under a
        // surface belt, a same-axis underground under another). A well-behaved client blocks
        // this in its tool, so reaching here means a malicious or desynced client. Undergrounds
        // sit on a per-axis layer, so a crossing tunnel or a surface belt above does not collide.
        const layer = beltOccupancyLayer(options.type, options.direction);
        if (this.game.queryScalar("IsOccupied", {x: options.x, y: options.y, layer}) !== null) {
            console.warn("CreateBelt ignored: tile occupied at", options.x, options.y);
            throw new PlacementRejected();
        }
        try {
            const id = this.game.queryScalar("AllocateObjectId");
            return this.game.queryScalar("InsertBelt", {id, ...options});
        } catch (e) {
            const msg = String(e);
            if (msg.includes("Belt.x") && msg.includes("Belt.y")) {
                console.warn("CreateBelt ignored: belt already exists at", options.x, options.y);
                throw new PlacementRejected();
            }
            if (msg.includes("Belt.parent_id")) {
                console.warn("CreateBelt ignored: conflicting parent at", options.x, options.y);
                throw new PlacementRejected();
            }
            throw e;
        }
    }

    /**
     * Resolves the new belt's path head and downstream child (with derived merge-topology flags) in one query.
     * @private
     * @param {BigInt} id
     * @param {{x: number, y: number, type: number, direction: Direction, chunk: number}} options
     * @returns {{head: BigInt, child: ({id: BigInt, x: number, y: number, oldParentPathHead: BigInt|null, isStandalone: boolean, hadParent: boolean, isCrossChunk: boolean, parentInDifferentChunk: boolean})|null}}
     */
    _resolveCreateContext(id, options) {
        const row = this.game.querySingle("GetBeltCreateContext", {id, ...options});

        let child = null;
        if (row.child_id !== null) {
            child = {
                id: row.child_id,
                x: row.child_x,
                y: row.child_y,
                oldParentPathHead: row.old_parent_path_head,
                isStandalone: row.child_path === row.child_id,
                hadParent: row.child_old_parent !== null,
                isCrossChunk: row.child_chunk !== options.chunk,
                parentInDifferentChunk: row.child_old_parent_chunk !== row.child_chunk,
            };
        }

        return {head: row.head, child};
    }

    /**
     * True for the fast path: the new belt is a head merging a same-chunk standalone child (no path_index shift).
     * @private
     */
    _isStandaloneChildMerge(id, head, child) {
        return child !== null
            && head === id
            && child.isStandalone
            && !child.hadParent
            && !child.isCrossChunk;
    }

    /**
     * Fast path: absorbs a same-chunk standalone child into the new head without stashing items.
     * @private
     */
    _mergeStandaloneChild(id, head, child, options) {
        this._relinkChild(child, options);

        const createdNewPath = this.game.queryScalar("InsertBeltPath", {id: head});
        this.game.exec("CalculateBeltPath", {id: head});
        this.game.exec("TransferBeltPathItems", {from: child.id, to: head});

        const inheritedOutPort = this._absorbChildPath(head, child);

        this.game.exec("MaterializeBeltPath", {id: head});
        if (createdNewPath) {
            this._populateBeltPathPorts(head, inheritedOutPort);
        }
        this.game.exec("FillHeadGap", {id: head});
        this.game.exec("RecalculateNextGapForPath", {id: head});
        this.game.exec("RecalculateNextItemForPath", {id: head});

        this._publishPathRecalculate(head, options.x, options.y);
        this._publishBeltInsert(id, options);
    }

    /**
     * General path: merges paths, splits a cross-chunk child onto a new path, and/or detaches it from a previous parent.
     * @private
     */
    _rebuildPaths(id, head, child, options) {
        const oldParentPathHead = child === null ? null : child.oldParentPathHead;

        // The new belt closed a loop by feeding `child`, a non-head belt of its own
        // path (the child's old parent already lived in that path). `child` becomes the
        // loop's seam head and the run upstream of it splits into its own path.
        if (child !== null && child.hadParent && child.oldParentPathHead === head && child.id !== head) {
            this._closeLoopOntoMiddle(id, head, child, options);
            return;
        }

        if (child !== null) {
            this._relinkChild(child, options);
            this._stashItems(child.id);

            if (child.isStandalone) {
                this._stashOutputItem(child.id);
            }

            if (child.hadParent) {
                this._stashItems(oldParentPathHead);
                this._stashOutputItem(oldParentPathHead);
                this.game.exec("CalculateBeltPath", {id: oldParentPathHead});
                this.game.exec("InvalidatePath", {id: oldParentPathHead});
            }

            if (child.isCrossChunk) {
                this._splitChildPath(child);
            }
        }

        // The child's path folds into head only when the merge stays within one chunk
        // and the child either had no upstream parent or that parent lived elsewhere
        // (so head isn't stealing a still-connected cross-chunk link), and the child
        // isn't head itself.
        const childFoldsIntoHead = child !== null
            && (!child.hadParent || child.parentInDifferentChunk)
            && child.id !== head
            && !child.isCrossChunk;

        if (child !== null || head !== id) {
            // A folding child's standalone stash omits the one boundary slot that becomes
            // internal once it joins the head's path; pad it so the head's items keep their
            // distance from the out-port instead of sliding a slot toward the sink. An item
            // resting in the child's (now interior) in-port rides that slot rather than
            // vanishing with the discarded port.
            if (childFoldsIntoHead) {
                if (this.game.queryScalar("ChildHasInputItem", {id: child.id}) !== null) {
                    this.game.exec("StashChildInputItem", {id, child: child.id});
                } else {
                    this.game.exec("StashGapSlot", {id});
                }
            }
            // head !== id means the new belt extends the path's output side (a tail
            // extension, or a merge linking the tail onto a downstream belt), so it sits
            // on the path's former output tile. If the path's output item is resting in
            // the port, flow it onto that belt's input edge rather than leaving it in the
            // out-port — which the merge discards (losing it) or the extension reuses a
            // tile downstream (teleporting it forward).
            if (head !== id && this.game.queryScalar("PathHasOutputItem", {id: head})) {
                this.game.exec("StashNewBeltWithOutputItem", {id, head});
                this.game.exec("RemoveOutputItem", {id: head});
            } else {
                this.game.exec("StashGap", {id});
            }
            this._stashItems(head);
        }

        const createdNewPath = this.game.queryScalar("InsertBeltPath", {id: head});
        this.game.exec("CalculateBeltPath", {id: head});

        let inheritedOutPort = null;
        if (childFoldsIntoHead) {
            inheritedOutPort = this._absorbChildPath(head, child);
        }

        this.game.exec("MaterializeBeltPath", {id: head});
        if (createdNewPath) {
            this._populateBeltPathPorts(head, inheritedOutPort);
        } else if (child === null && head !== id) {
            // The new belt extended an existing path as its new tail (no downstream belt to
            // merge), so the path's out-port still points at the old tail's downstream. Re-adopt
            // the new tail's downstream in-port (e.g. a splitter the belt now feeds into).
            this._adoptTailOutPort(head);
        }
        this._unifyLoopPort(head);
        this._publishPathRecalculate(head, options.x, options.y);

        if (oldParentPathHead) {
            this.game.exec("MaterializeBeltPath", {id: oldParentPathHead});
            this._publishPathRecalculate(oldParentPathHead, options.x, options.y);
        }

        this._unStashItems();

        if (oldParentPathHead) {
            this.game.exec("FillHeadGap", {id: oldParentPathHead});
        }
        this.game.exec("FillHeadGap", {id: head});

        if (child !== null && (child.hadParent || child.isStandalone)) {
            this._unStashOutputItem();
            this.game.exec("FillHeadGap", {id: child.id});
        }

        this._publishBeltInsert(id, options);
    }

    /**
     * Splits a path where a newly-placed belt closed a loop onto one of its own
     * members: @child becomes the loop's seam head (parent nulled) and the run that
     * was upstream of it (still headed by @head) becomes a separate path feeding the
     * loop through ports.
     * @private
     */
    _closeLoopOntoMiddle(id, head, child, options) {
        // Stash the old path's items before the split; each re-materializes onto
        // whichever of the two new paths its belt lands in.
        this._stashItems(head);

        // Re-point the child at the new belt (the loop's internal link), then make the
        // new belt the loop's seam head, breaking the cycle. The run that was upstream
        // of the child splits off, still headed by @head.
        this._relinkChild(child, options);
        this.game.exec("NullifyParent", {id});

        this.game.exec("InvalidatePath", {id: head});
        this.game.exec("CalculateBeltPath", {id: head});
        const createdLoop = this.game.queryScalar("InsertBeltPath", {id});
        this.game.exec("CalculateBeltPath", {id});

        this.game.exec("MaterializeBeltPath", {id: head});
        this._populateBeltPathPorts(head);
        this.game.exec("MaterializeBeltPath", {id});
        if (createdLoop) {
            this._populateBeltPathPorts(id);
        }
        this._unifyLoopPort(id);

        this._unStashItems();
        this.game.exec("FillHeadGap", {id: head});
        this.game.exec("FillHeadGap", {id});

        this._publishPathRecalculate(head, options.x, options.y);
        this._publishPathRecalculate(id, options.x, options.y);
        this._publishBeltInsert(id, options);
    }

    /**
     * Re-points the downstream child at its new upstream parent and notifies clients.
     * @private
     */
    _relinkChild(child, options) {
        this.game.exec("UpdateBeltChild", {id: child.id});
    }

    /**
     * Folds the child's path into `head`, which inherits its output port; returns that out_port_id.
     * @private
     * @returns {BigInt|null}
     */
    _absorbChildPath(head, child) {
        this.game.exec("DeleteOutPort", {id: head});

        // When the child already feeds the head, folding it in closes a loop: the
        // inherited out port equals the head's own in port, so the path shares one port
        // for both ends (kept by _unifyLoopPort) and items circulate through it.
        const inheritedOutPort = this.game.queryScalar("InheritOutPort", {child: child.id, parent: head});
        this._deletePathInPort(child.id);
        this.game.exec("DeletePath", {id: child.id});
        return inheritedOutPort;
    }

    /**
     * Drops a path's in-port unless another object still feeds it (uses it as one of its output
     * ports) — keeping a shared seam port alive when a downstream path is reassigned.
     * @private
     * @param {BigInt} pathId
     * @returns {void}
     */
    _deletePathInPort(pathId) {
        const inPort = this.game.queryScalar("GetPathInPort", {id: pathId});
        if (inPort !== null) {
            this.game.exec("DeletePortIfNotOutputReferenced", {port: inPort});
        }
    }

    /**
     * Splits the child onto its own new path (it crossed into a different chunk
     * from the new belt, so they cannot share a path) and notifies clients.
     * @private
     */
    _splitChildPath(child) {
        const created = this.game.queryScalar("InsertBeltPath", {id: child.id});
        this.game.exec("CalculateBeltPath", {id: child.id});
        this.game.exec("MaterializeBeltPath", {id: child.id});
        if (created) {
            this._populateBeltPathPorts(child.id);
        }
        this._publishPathRecalculate(child.id, child.x, child.y);
    }

    /**
     * Emits a path-recalculate event carrying the path's belt ids in order.
     * @private
     */
    _publishPathRecalculate(pathHead, x, y) {
        const parts = this._getPath(pathHead);
        const outPortId = this.game.queryScalar("GetPathOutPort", {id: pathHead});
        this.game.publishEventNow(new BeltPathRecalculateEvent(x, y, parts, outPortId));
        // An edit re-rows the path under new ids; the client re-syncs its items at the
        // edit's end (_flushItemResync), so a destroyed item's sprite doesn't linger a tick.
        this._resyncHeads.add(pathHead);
    }

    /**
     * Re-syncs every path touched this edit, once — after all belt inserts and item
     * un-stashing are done. The timing is essential: an edit can flow an out-port item onto
     * a freshly inserted belt only at its very end, so re-syncing at each path recalc would
     * miss the new row (and its belt would not be in the client cache yet).
     * @private
     */
    _flushItemResync() {
        this._resyncHeads.forEach(head => {
            const belt = this.game.querySingle("GetBelt", {id: head});
            if (belt !== null) {
                this._resyncPathItemsNow(head, belt.x, belt.y);
            }
        });
        this._resyncHeads.clear();
    }

    /**
     * Re-syncs a path's items on the client immediately: emits a RESET then an UPSERT per
     * RLE row, mirroring EmitResyncReset + EmitResyncItems but published now rather than via
     * the next tick's journal drain.
     * @private
     * @param {BigInt} pathHead
     * @param {number} x - head tile, for the routing chunk
     * @param {number} y
     */
    _resyncPathItemsNow(pathHead, x, y) {
        const routing_chunk_x = Math.floor(x / CHUNK_SIZE);
        const routing_chunk_y = Math.floor(y / CHUNK_SIZE);
        this.game.publishEventNow(new BufferedEvent({
            type: BUFFERED_EVENT_TYPE_ITEM_RESET, routing_chunk_x, routing_chunk_y, id: pathHead,
        }));
        this.game.query("GetBeltPathItems", {id: pathHead}).forEach(row => {
            this.game.publishEventNow(new BufferedEvent({
                // Number(row.id): the journal path narrows a to Number; key it the same.
                type: BUFFERED_EVENT_TYPE_ITEM_SYNC, routing_chunk_x, routing_chunk_y, id: pathHead,
                a: Number(row.id), b: row.length, c: row.type,
            }));
        });
    }

    /**
     * @private
     * @param {{x: number, y: number, type: number, rampParent: BigInt, disconnectRampChild: BigInt}} options
     */
    _disconnectRampChain(options) {
        // Validation throws propagate to the transaction owner (_createBelt), which rolls back once.
        if (!options.rampParent || !isRamp(options.type)) {
            throw new Error("Ramp disconnect: no valid ramp parent");
        }

        const rampChild = this.game.querySingle("GetBelt", {id: options.disconnectRampChild});
        if (!rampChild || rampChild.type !== options.type) {
            throw new Error("Ramp disconnect: ramp child missing or type mismatch");
        }

        const distanceX = Math.abs(options.x - rampChild.x);
        const distanceY = Math.abs(options.y - rampChild.y);
        if ((distanceX !== 0 && distanceY !== 0)
            || (Math.max(distanceX, distanceY) - 2) > MAX_UNDERGROUND_LENGTH) {
            throw new Error("Ramp disconnect: span not straight or exceeds MAX_UNDERGROUND_LENGTH");
        }

        const rampQuery = options.type === BELT_RAMP_DOWN ? "GetRampChildren" : "GetRampParents";
        const rampBelts = this.game.query(rampQuery, {id: options.disconnectRampChild});
        rampBelts.forEach(belt => this._removeBelt(belt.id, true));
    }

    /**
     * @private
     * @param {{x: number, y: number, direction: Direction, type: number, rampParent: BigInt}} options
     */
    _createUndergrounds(options) {
        const rampParent = this.game.querySingle("GetBelt", {id: options.rampParent});
        const undergrounds = getUndergroundBeltsToCreate(rampParent, options);
        undergrounds.forEach(underground => {
            this._createBelt({
                x: underground.x,
                y: underground.y,
                direction: options.direction,
                type: BELT_UNDERGROUND,
            }, false);
        });
    }

    // ---- Belt removal ----

    /**
     * Removes one belt and rebuilds the paths around it (ramps cascade through their tunnel).
     * @private
     * @param {BigInt} id
     * @param {boolean} [recursive] - true for cascaded underground/ramp segments;
     *     only the outermost call owns the begin/end boundary and the final un-stash.
     * @param {BigInt[]} [fillHeadGap] - path heads accumulated across the cascade
     *     whose head_gap must be refilled once, after all items are un-stashed.
     */
    _removeBelt(id, recursive=false, fillHeadGap=[]) {
        if (!recursive) {
            this.game.begin();
            this._resyncHeads = new Set();
            this._orphanedHeads = new Set();
        }

        const belt = this.game.querySingle("GetBelt", {id});
        if (belt == null) {
            console.warn("DeleteBelt ignored: no belt with id", id);
            if (!recursive) {
                this.game.rollback();
            }
            return;
        }

        // Reject manual underground deletion before touching any state, and unwind
        // with rollback (not end/commit) so a refused delete can never leave a
        // partial mutation behind.
        if (belt.type === BELT_UNDERGROUND && !recursive) {
            this.game.rollback();
            throw new Error("Cannot manually delete underground belt.");
        }

        // If this belt sits on a loop, remember the loop's seam (its head plus the
        // belt that physically feeds it): loops are stored as a path whose head's
        // parent is nulled, leaving the wrap-around connection disconnected. Once the
        // deletion breaks the cycle that seam can (and must) be re-linked, or the run
        // is left fragmented / a stale tail collides. Detect before mutating (so the
        // feeder geometry is captured pre-deletion); heal after the removal settles.
        const loopSeam = recursive ? null : this._loopSeam(id);

        // Capture this ramp's tunnel partner (the opposite-end ramp) before the
        // deletion tears the chain down: once it survives orphaned, the removal can
        // try to re-link it to another ramp now within reach. Detect pre-mutation
        // (the parent_id chain is still intact); reconnect after the removal settles.
        const orphanedRamp = recursive ? null : this._tunnelPartner(belt, id);

        this._stashOutputItem(id);

        let {child, parentId} = this._eraseBelt(id);
        let childId = child === null ? null : child.id;
        this.game.publishEventNow(new BeltDeleteEvent(belt.x, belt.y, id));

        // When deleting a RAMP_UP with multiple underground belts, all undergrounds share the
        // same path head. Only the innermost underground (whose parent is not underground) should
        // manage the parent path head — otherwise each deletion stashes items independently and
        // the accumulated stash exceeds the recalculated path length, violating the head_gap
        // constraint.
        if (belt.type === BELT_UNDERGROUND && recursive && belt.parent_type === BELT_UNDERGROUND) {
            parentId = null;
        }

        ({childId, parentId} = this._collapseRampChain(belt, childId, parentId, fillHeadGap));

        let parentPathHead = null;
        if (parentId) {
            parentPathHead = this._prepareParentPath(parentId);
        }

        if (childId && childId !== parentPathHead) {
            this._splitOrphanedChildPath(child);
        }

        if (parentPathHead) {
            this._finalizeParentPath(parentPathHead, belt, fillHeadGap);
        }

        if (childId && childId !== parentPathHead) {
            fillHeadGap.push(childId);
        }

        if (!recursive) {
            this._finalizeRemoval(fillHeadGap, loopSeam, orphanedRamp);
        }
    }

    /**
     * Describes @id's path when it's a loop — its head and wrap-around feeder — or null if not a loop.
     * @private
     * @param {BigInt} id
     * @returns {{head: BigInt, upstreamNeighbor: BigInt}|null}
     */
    _loopSeam(id) {
        const head = this._getBeltPathHead(id);
        if (head === null) {
            return null;
        }
        const upstreamNeighbor = this.game.queryScalar("FindUpstreamNeighbor", {id: head});
        if (upstreamNeighbor === null) {
            return null;
        }
        if (this._getBeltPathHead(upstreamNeighbor) !== head) {
            return null;
        }
        return {head, upstreamNeighbor};
    }

    /**
     * Re-links a loop seam left dangling by a deletion, folding the head's path into its upstream neighbor's.
     * @private
     * @param {{head: BigInt, upstreamNeighbor: BigInt}|null} loopSeam
     */
    _healLoopSeam(loopSeam) {
        if (loopSeam === null) {
            return;
        }
        const {head: loopHead, upstreamNeighbor} = loopSeam;

        // The seam head still dangles only if it survived the deletion and remains
        // parentless; its GetBelt row (needed for the relink below) doubles as that
        // check, so no separate IsNullHead query is required.
        const seamBelt = this.game.querySingle("GetBelt", {id: loopHead});
        if (seamBelt == null || seamBelt.parent_id !== null) {
            return;
        }
        // The feeder captured pre-deletion may itself have been removed; if so the run
        // is already open and there is nothing to re-link (the client re-derives the seam
        // head's bend from the cache, so no render update is needed).
        const neighborBelt = this.game.querySingle("GetBelt", {id: upstreamNeighbor});
        if (neighborBelt == null) {
            return;
        }
        const upstreamHead = this._getBeltPathHead(upstreamNeighbor);
        if (upstreamHead === loopHead) {
            // Still one path (an intact loop) — re-linking would recreate the cycle.
            return;
        }
        this._foldHeadIntoUpstream(
            {id: loopHead, x: seamBelt.x, y: seamBelt.y},
            neighborBelt,
            upstreamHead,
        );
    }

    /**
     * Folds a dangling parentless head into its straight upstream neighbor's path,
     * preserving in-flight items across the re-index.
     * @private
     * @param {{id: BigInt, x: number, y: number}} head - the dangling head
     * @param {{x: number, y: number}} neighborBelt - the belt feeding it
     * @param {BigInt} upstreamHead - head of the neighbor's path, which absorbs head
     */
    _foldHeadIntoUpstream(head, neighborBelt, upstreamHead) {
        this._stashItems(head.id);
        this._stashItems(upstreamHead);

        // Re-point the head at its upstream neighbor through the same helper creation
        // uses, so parent_id is set by the shared geometry and clients get the bend update.
        this._relinkChild(
            {id: head.id, x: head.x, y: head.y},
            {x: neighborBelt.x, y: neighborBelt.y},
        );

        this.game.exec("CalculateBeltPath", {id: upstreamHead});
        this._absorbChildPath(upstreamHead, {id: head.id});
        this.game.exec("MaterializeBeltPath", {id: upstreamHead});

        this._unStashItems();
        this.game.exec("FillHeadGap", {id: upstreamHead});

        const upstreamBelt = this.game.querySingle("GetBelt", {id: upstreamHead});
        this._publishPathRecalculate(upstreamHead, upstreamBelt.x, upstreamBelt.y);
    }

    /**
     * Merges each orphaned head left by the removal into a straight upstream neighbor
     * on another path. A junction that fed the head through a port becomes a direct
     * inline feeder once the head's own upstream belt is gone, making the two one run.
     * @private
     */
    _reconnectOrphanedHeads() {
        this._orphanedHeads.forEach(headId => {
            const headBelt = this.game.querySingle("GetBelt", {id: headId});
            if (headBelt === null || headBelt.parent_id !== null) {
                return;
            }
            const upstreamNeighbor = this.game.queryScalar("FindUpstreamNeighbor", {id: headId});
            if (upstreamNeighbor === null) {
                return;
            }
            const neighborBelt = this.game.querySingle("GetBelt", {id: upstreamNeighbor});
            if (neighborBelt === null) {
                return;
            }
            // Paths never cross a chunk border, so a cross-chunk feeder stays a port link.
            if (neighborBelt.chunk !== headBelt.chunk) {
                return;
            }
            const upstreamHead = this._getBeltPathHead(upstreamNeighbor);
            if (upstreamHead === headId) {
                return;
            }
            this._foldHeadIntoUpstream(
                {id: headId, x: headBelt.x, y: headBelt.y},
                neighborBelt,
                upstreamHead,
            );
        });
    }

    /**
     * Cascades a ramp deletion through its underground tunnel, clearing the spent child/parent link.
     * @private
     * @returns {{childId: BigInt|null, parentId: BigInt|null}}
     */
    _collapseRampChain(belt, childId, parentId, fillHeadGap) {
        if (belt.type === BELT_RAMP_DOWN) {
            const rampBelts = this.game.query("GetRampChildren", {id: childId});
            rampBelts.forEach(child => {
                this._removeBelt(child.id, true, fillHeadGap);
                childId = null;
            });
        } else if (belt.type === BELT_RAMP_UP) {
            const rampBelts = this.game.query("GetRampParents", {id: parentId});
            rampBelts.forEach(parent => {
                this._removeBelt(parent.id, true, fillHeadGap);
                parentId = null;
            });
        }
        return {childId, parentId};
    }

    /**
     * Stashes the former parent path's items and invalidates it so it can be
     * re-materialized (shorter, minus the removed belt) during finalization.
     * @private
     * @returns {BigInt} the parent's path head
     */
    _prepareParentPath(parentId) {
        const parentPathHead = this._getBeltPathHead(parentId);
        this.game.exec("InsertBeltPath", {id: parentPathHead});
        this._stashItems(parentPathHead);
        this._stashOutputItem(parentPathHead);
        this.game.exec("CalculateBeltPath", {id: parentPathHead});
        this.game.exec("InvalidatePath", {id: parentPathHead});
        return parentPathHead;
    }

    /**
     * Promotes the removed belt's former child to the head of its own new path
     * (it lost its upstream parent) and stashes its items for re-materialization.
     * @private
     * @param {{id: BigInt, x: number, y: number}} child
     */
    _splitOrphanedChildPath(child) {
        const childId = child.id;
        this.game.exec("NullifyPathTail", {id: childId});
        const created = this.game.queryScalar("InsertBeltPath", {id: childId});
        this._stashItems(childId);
        this.game.exec("CalculateBeltPath", {id: childId});

        // When a loop is broken, the orphaned arc can wrap back onto a belt the old
        // loop path still claims as its tail. Clear that stale claim before
        // materializing so the UNIQUE(tail_id) constraint isn't violated; the old
        // path is recalculated later in this same removal.
        const newTail = this.game.queryScalar("GetPathTailBelt", {id: childId});
        this.game.exec("NullifyPathTail", {id: newTail});

        this.game.exec("MaterializeBeltPath", {id: childId});

        if (created) {
            this._populateBeltPathPorts(childId);
        }

        // The orphaned belts now form their own path; announce its composition under
        // the new head (mirrors _finalizeParentPath) so clients tracking paths re-key
        // it off the deleted head.
        this._publishPathRecalculate(childId, child.x, child.y);

        // The deletion may have exposed a belt straight behind this new head (a junction
        // feeder that fed it through a port); reconnect once the removal settles.
        this._orphanedHeads.add(childId);
    }

    /**
     * Re-materializes the parent path and queues its head_gap refill (deferred
     * until after un-stash so item lengths are known).
     * @private
     */
    _finalizeParentPath(parentPathHead, belt, fillHeadGap) {
        fillHeadGap.push(parentPathHead);
        this.game.exec("MaterializeBeltPath", {id: parentPathHead});
        this._publishPathRecalculate(parentPathHead, belt.x, belt.y);
    }

    /**
     * Top-level wrap-up: un-stash items, refill each touched path's head_gap, heal the
     * loop seam, re-link an orphaned tunnel partner, then commit.
     * @private
     * @param {BigInt[]} fillHeadGap
     * @param {{head: BigInt, upstreamNeighbor: BigInt}|null} loopSeam
     * @param {{id: BigInt, x: number, y: number, type: number, direction: Direction}|null} orphanedRamp
     */
    _finalizeRemoval(fillHeadGap, loopSeam, orphanedRamp) {
        this._unStashItems();
        this._unStashOutputItem();

        if (new Set(fillHeadGap).size !== fillHeadGap.length) {
            throw new Error("fillHeadGap has duplicate entries");
        }

        fillHeadGap.forEach(pathId => {
            const trimmed = this.game.queryScalar("TrimOverflowItems", {id: pathId});
            if (trimmed !== null) {
                this.game.exec("DropTrailingHeadGaps", {id: pathId});
                this.game.exec("RecalculateNextGapForPath", {id: pathId});
                this.game.exec("RecalculateNextItemForPath", {id: pathId});
            }
            this.game.exec("FillHeadGap", {id: pathId});
        });

        this._healLoopSeam(loopSeam);
        this._reconnectOrphanedHeads();
        this._reconnectOrphanedRamp(orphanedRamp);

        this._flushItemResync();
        this.game.end();
    }

    /**
     * The opposite-end ramp of @belt's tunnel, or null for a lone ramp or non-ramp belt.
     * @private
     * @param {{type: number}} belt
     * @param {BigInt} id
     * @returns {{id: BigInt, x: number, y: number, type: number, direction: Direction}|null}
     */
    _tunnelPartner(belt, id) {
        if (belt.type === BELT_RAMP_DOWN) {
            return this.game.querySingle("GetDownstreamRamp", {id});
        }
        if (belt.type === BELT_RAMP_UP) {
            return this.game.querySingle("GetUpstreamRamp", {id});
        }
        return null;
    }

    /**
     * Rebuilds a tunnel from an orphaned surviving ramp to a free partner now within reach.
     * @private
     * @param {{id: BigInt, x: number, y: number, type: number, direction: Direction}|null} orphanedRamp
     */
    _reconnectOrphanedRamp(orphanedRamp) {
        if (orphanedRamp === null) {
            return;
        }
        // The partner survives the collapse, but guard against it having been
        // consumed by another step of this removal before re-querying.
        const survivor = this.game.querySingle("GetBelt", {id: orphanedRamp.id});
        if (survivor === null) {
            return;
        }

        const candidate = this._findReconnectRamp(orphanedRamp);
        if (candidate === null) {
            return;
        }

        // Order the pair entrance-first so the buried tiles read along the flow.
        const entrance = orphanedRamp.type === BELT_RAMP_DOWN ? orphanedRamp : candidate;
        const exit = orphanedRamp.type === BELT_RAMP_DOWN ? candidate : orphanedRamp;
        const undergrounds = getUndergroundBeltsToCreate(entrance, exit);
        if (undergrounds.length === 0) {
            return;
        }

        // Laying the undergrounds entrance-to-exit re-links the whole chain: each
        // underground picks up its upstream parent, and the last one re-parents the
        // exit, folding its orphaned path back in (items stashed/un-stashed by the
        // shared create path). transaction=false keeps it inside this removal.
        undergrounds.forEach(underground => {
            this._createBelt({
                x: underground.x,
                y: underground.y,
                direction: entrance.direction,
                type: BELT_UNDERGROUND,
            }, false);
        });
    }

    /**
     * The nearest unpaired complementary ramp the surviving ramp can tunnel to along its axis, or null.
     * @private
     * @param {{x: number, y: number, type: number, direction: Direction}} survivor
     * @returns {{id: BigInt, x: number, y: number, type: number, direction: Direction}|null}
     */
    _findReconnectRamp(survivor) {
        const {dx, dy} = tunnelStep(survivor.type, survivor.direction);
        const complementaryType = survivor.type === BELT_RAMP_UP ? BELT_RAMP_DOWN : BELT_RAMP_UP;
        const rows = this.game.query("GetBeltsAlongAxis", {
            x: survivor.x,
            y: survivor.y,
            dx,
            dy,
            maxSteps: MAX_UNDERGROUND_LENGTH + 1,
        });

        // rows arrive nearest-first; stop at the first surface ramp. A same-type ramp
        // blocks pairing; the complementary ramp facing the same way is the candidate;
        // anything else (normal belts, buried undergrounds) the tunnel passes under.
        let candidate = null;
        for (let i = 0; i < rows.length && candidate === null; i += 1) {
            const row = rows[i];
            if (row.type === BELT_UNDERGROUND) {
                continue;
            }
            if (row.type === survivor.type) {
                return null;
            }
            if (row.type === complementaryType && row.direction === survivor.direction) {
                candidate = row;
            }
        }
        if (candidate === null) {
            return null;
        }

        // A same-axis underground in the gap (a parallel tunnel) would collide with
        // ours, so refuse rather than abort the whole removal. A perpendicular one is
        // a crossing tunnel our undergrounds can share the tile with (see the
        // axis-aware Belt_x_y_underground index), so it doesn't block.
        const axis = Direction.axis(survivor.direction);
        const gapBlocked = rows.some(row =>
            row.type === BELT_UNDERGROUND
            && row.distance < candidate.distance
            && Direction.axis(row.direction) === axis
        );
        if (gapBlocked) {
            return null;
        }

        // Only adopt a free ramp; never steal one already serving its own tunnel.
        const candidatePaired = complementaryType === BELT_RAMP_DOWN
            ? this.game.querySingle("GetDownstreamRamp", {id: candidate.id})
            : this.game.querySingle("GetUpstreamRamp", {id: candidate.id});
        if (candidatePaired !== null) {
            return null;
        }

        return {id: candidate.id, x: candidate.x, y: candidate.y, type: candidate.type, direction: candidate.direction};
    }

    // ---- Helpers ----

    /**
     * Removes all DB rows for a belt and returns its former child (id plus its
     * immutable tile, used to refresh the now-parentless child's bend) and the id
     * of its former parent.
     * @private
     * @param {BigInt} id
     * @returns {{child: {id: BigInt, x: number, y: number}|null, parentId: BigInt|null}}
     */
    _eraseBelt(id) {
        const child = this.game.querySingle("DetachChild", {id});
        this.game.exec("DeleteItems", {id});
        this.game.exec("UnassignBeltPath", {id});
        // Capture the path's ports before its row goes, then drop the path and GC each port once
        // nothing (this path's row now gone, plus any other object) still references it.
        const inPort = this.game.queryScalar("GetPathInPort", {id});
        const outPort = this.game.queryScalar("GetPathOutPort", {id});
        this.game.exec("DeletePath", {id});
        if (inPort !== null) {
            this.game.exec("DeletePortIfUnreferenced", {port: inPort});
        }
        if (outPort !== null) {
            this.game.exec("DeletePortIfUnreferenced", {port: outPort});
        }
        this.game.exec("ClearSolitaryBeltPortItem", {id});
        this.game.exec("NullifyPathTail", {id});
        const parentId = this.game.queryScalar("DeleteBeltRow", {id});
        return {child, parentId};
    }

    /**
     * @private
     * @param {BigInt} id
     * @param {{x: number, y: number, direction: number, type: number}} options
     */
    _publishBeltInsert(id, options) {
        this.game.publishEventNow(new BeltInsertEvent(options.x, options.y, id, options.direction, options.type));
    }

    /**
     * @param id {BigInt}
     * @private
     */
    _stashItems(id) {
        this.game.exec("StashItems", {id});
        this.game.exec("DeleteItems", {id});
    }

    /**
     * @param id {BigInt}
     * @private
     */
    _stashOutputItem(id) {
        this.game.exec("StashOutputItem", {id});
        this.game.exec("RemoveOutputItem", {id});
    }

    /**
     * @private
     */
    _unStashItems() {
        this.game.exec("UnStashItems");
        // Recalculate only the paths the un-stash touched (still recorded in
        // StashedItem), not every path in the world, then clear the stash.
        this.game.exec("RecalculateNextGapForStashedPaths");
        this.game.exec("RecalculateNextItemForStashedPaths");
        this.game.exec("TruncateStashedItems");
    }

    /**
     * @private
     */
    _unStashOutputItem() {
        this.game.exec("UnStashOutputItem");
        this.game.exec("TruncateStashedOutputItem");
    }

    /**
     * @private
     * @param {BigInt} id
     * @returns {BigInt[]}
     */
    _getPath(id) {
        const rows = this.game.query("GetBeltPath", {id});
        return rows.map(row => row.id);
    }

    /**
     * @private
     * @param {BigInt} id
     * @returns {BigInt|null}
     */
    _getBeltPathHead(id) {
        const result = this.game.query("GetBeltPathHead", {id});

        if (result.length === 0) {
            return null;
        }

        return result[result.length - 1].id;
    }

    /**
     * @private
     * @param {BigInt} id
     * @param {BigInt|null} [inheritedOutPort] - existing out_port_id to preserve when no downstream exists
     */
    _populateBeltPathPorts(id, inheritedOutPort = null) {
        const head = this.game.querySingle("GetBelt", {id});
        const tail = this.game.querySingle("GetTail", {id});

        const outputPorts = upstreamPorts(this.game, "Belt", head);

        // When more than one adjacent output feeds this head, deterministically pick
        // the oldest (lowest id) port so path resolution is stable regardless of the
        // order upstreamPorts returns them in. Math.min can't be used here: port ids
        // are BigInt.
        const candidatePorts = Object.values(outputPorts);
        let inputPort;
        if (candidatePorts.length > 0) {
            inputPort = candidatePorts.reduce((oldest, port) => (port < oldest ? port : oldest));
        } else {
            inputPort = this.game.queryScalar("InsertPort");
        }

        const inputPorts = downstreamPorts(this.game, "Belt", tail);
        let outputPort = Object.values(inputPorts)[0];
        if (outputPort) {
            const childPath = this.game.queryScalar("GetBeltPathPortOwner", {id: outputPort});

            if (childPath) {
                this._deletePathInPort(childPath);
                const port = this.game.queryScalar("InsertPort");
                this.game.exec("UpdateInPort", {id: childPath, port});
                this.game.exec("MarkPortAsInput", {port});
                outputPort = port;
            }
        } else {
            outputPort = inheritedOutPort || this.game.queryScalar("InsertPort");
        }

        this.game.exec("UpdateBeltPathPorts", {id, inPort: inputPort, outPort: outputPort});
        this.game.exec("MarkPortAsInput", {port: inputPort});
    }

    /**
     * Re-adopts the path's out-port from its (new) tail's downstream in-port, replacing the
     * stale out-port a tail extension left behind. Only when the downstream is a non-belt
     * object's in-port (a belt downstream is a child merge, handled elsewhere); a tail feeding
     * nothing keeps its fresh out-port.
     * @private
     * @param {BigInt} head
     */
    _adoptTailOutPort(head) {
        const tail = this.game.querySingle("GetTail", {id: head});
        if (tail === null) {
            return;
        }
        const adopted = Object.values(downstreamPorts(this.game, "Belt", tail))[0];
        if (!adopted || this.game.queryScalar("GetBeltPathPortOwner", {id: adopted})) {
            return;
        }
        const inPort = this.game.queryScalar("GetPathInPort", {id: head});
        this.game.exec("DeleteOutPort", {id: head});
        this.game.exec("UpdateBeltPathPorts", {id: head, inPort, outPort: adopted});
    }

    /**
     * Collapses a loop's two seam ports into one shared port. A loop's tail belt feeds its
     * own head, so the head's in-port and the tail's out-port land at the same boundary as
     * distinct rows; sharing one port lets the popped lead item re-ingest, so items
     * circulate. No-op for an open path (tail feeds elsewhere) or an already-shared loop.
     * @private
     * @param {BigInt} head
     */
    _unifyLoopPort(head) {
        const headBelt = this.game.querySingle("GetBelt", {id: head});
        const tail = this.game.querySingle("GetTail", {id: head});
        if (headBelt === null || tail === null) {
            return;
        }
        // A loop only when the tail belt physically feeds the head's tile.
        if (tail.x + Direction.dx(tail.direction) !== headBelt.x
            || tail.y + Direction.dy(tail.direction) !== headBelt.y) {
            return;
        }

        // Share one port for both ends so the popped lead item re-ingests (items circulate).
        const inPort = this.game.queryScalar("GetPathInPort", {id: head});
        const outPort = this.game.queryScalar("GetPathOutPort", {id: head});
        if (inPort !== null && outPort !== null && inPort !== outPort) {
            this.game.exec("DeleteOutPort", {id: head});
            this.game.exec("UpdateBeltPathPorts", {id: head, inPort, outPort: inPort});
        }
    }
}
