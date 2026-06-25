
import {
    AbstractMod,
    chunkKey,
    upstreamPorts,
    downstreamPorts,
} from "@/sdk/common.js";
import {CreateBeltMessage, DeleteBeltMessage} from "./messages.js";
import {
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    MAX_UNDERGROUND_LENGTH,
} from "./constants.js";
import {getUndergroundBeltsToCreate, tunnelStep} from "./geometry.js";
import {beltSchema, beltTempSchema} from "./schema.js";
import {BeltDefinition} from "./definitions.js";
import {beltStatements} from "./statements.js";
import {
    BeltPathRecalculateEvent,
    BeltInsertEvent,
    BeltUpdateEvent,
    BeltDeleteEvent,
    BeltSyncEvent,
} from "./events.js";

export class BeltMod extends AbstractMod {

    get wireClasses() {
        return [
            CreateBeltMessage,
            DeleteBeltMessage,
            BeltInsertEvent,
            BeltUpdateEvent,
            BeltDeleteEvent,
            BeltPathRecalculateEvent,
            BeltSyncEvent,
        ];
    }

    get schema() {
        return beltSchema;
    }

    get definitions() {
        return {Belt: BeltDefinition};
    }

    get tempSchema() {
        return beltTempSchema;
    }

    get statements() {
        return beltStatements;
    }

    // ---- Chunk sync ----

    /**
     * Returns a BeltSyncEvent for every belt in the chunk (undergrounds included, for the client's ramp scans).
     * @param {string} chunk
     * @returns {BeltSyncEvent[]}
     */
    collectChunkSync(chunk) {
        const belts = this.game.query("GetBeltsInChunk", {chunk});
        return belts.map(belt => new BeltSyncEvent(
            belt.x,
            belt.y,
            belt.id,
            belt.direction,
            belt.type,
            belt.parent_x,
            belt.parent_y,
        ));
    }

    // ---- AbstractMessage handling ----

    onMessage(message) {
        if (message instanceof CreateBeltMessage) {
            this._createBelt({
                x: message.x,
                y: message.y,
                direction: message.direction,
                type: message.beltType,
                rampParent: message.rampParent,
                disconnectRampChild: message.disconnectRampChild,
            });
        } else if (message instanceof DeleteBeltMessage) {
            this._removeBelt(message.id);
        }
    }

    // ---- Belt creation ----

    /**
     * Places one belt and rewires the affected paths around it.
     * @private
     * @param {{x: number, y: number, type: number, direction: Direction, [rampParent]: BigInt, [disconnectRampChild]: BigInt, [chunk]: string}} options
     * @param {boolean} [transaction] - false when called recursively, so only the outermost call owns the begin/end boundary
     */
    _createBelt(options, transaction=true) {
        options.chunk = chunkKey(options.x, options.y);
        if (transaction) {
            this.game.begin();
        }

        if (options.disconnectRampChild) {
            this._disconnectRampChain(options);
        }
        if (options.rampParent && (options.type === BELT_RAMP_UP || options.type === BELT_RAMP_DOWN)) {
            this._createUndergrounds(options);
        }

        const id = this._insertBelt(options);
        if (id === null) {
            // Placement rejected (tile occupied / parent conflict); _insertBelt
            // already rolled the transaction back, so there is nothing to commit.
            return;
        }

        const {head, child} = this._resolveCreateContext(id, options);

        if (this._isStandaloneChildMerge(id, head, child)) {
            this._mergeStandaloneChild(id, head, child, options);
        } else {
            this._rebuildPaths(id, head, child, options);
        }

        if (transaction) {
            this.game.end();
        }
    }

    /**
     * Inserts the Belt row and returns its id, or null (rolling back) on a placement conflict.
     * @private
     * @param {{x: number, y: number, type: number, direction: Direction}} options
     * @returns {BigInt|null}
     */
    _insertBelt(options) {
        try {
            return this.game.queryScalar("InsertBelt", options);
        } catch (e) {
            this.game.rollback();
            const msg = String(e);
            if (msg.includes("Belt.x") && msg.includes("Belt.y")) {
                console.warn("CreateBelt ignored: belt already exists at", options.x, options.y);
                return null;
            }
            if (msg.includes("Belt.parent_id")) {
                console.warn("CreateBelt ignored: conflicting parent at", options.x, options.y);
                return null;
            }
            throw new Error("FIXME: InsertBelt");
        }
    }

    /**
     * Resolves the new belt's path head and downstream child (with derived merge-topology flags) in one query.
     * @private
     * @param {BigInt} id
     * @param {{x: number, y: number, type: number, direction: Direction, chunk: string}} options
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

        if (child !== null || head !== id) {
            this.game.exec("StashGap", {id});
            this._stashItems(head);
        }

        const createdNewPath = this.game.queryScalar("InsertBeltPath", {id: head});
        this.game.exec("CalculateBeltPath", {id: head});

        // The child's path folds into head only when the merge stays within one chunk
        // and the child either had no upstream parent or that parent lived elsewhere
        // (so head isn't stealing a still-connected cross-chunk link), and the child
        // isn't head itself.
        const childFoldsIntoHead = child !== null
            && (!child.hadParent || child.parentInDifferentChunk)
            && child.id !== head
            && !child.isCrossChunk;

        let inheritedOutPort = null;
        if (childFoldsIntoHead) {
            inheritedOutPort = this._absorbChildPath(head, child);
        }

        this.game.exec("MaterializeBeltPath", {id: head});
        if (createdNewPath) {
            this._populateBeltPathPorts(head, inheritedOutPort);
        }
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
     * Re-points the downstream child at its new upstream parent and notifies clients.
     * @private
     */
    _relinkChild(child, options) {
        this.game.exec("UpdateBeltChild", {id: child.id});
        this.game.publishEventNow(new BeltUpdateEvent(child.x, child.y, child.id, options.x, options.y));
    }

    /**
     * Folds the child's path into `head`, which inherits its output port; returns that out_port_id.
     * @private
     * @returns {BigInt|null}
     */
    _absorbChildPath(head, child) {
        this.game.exec("DeleteOutPort", {id: head});
        const inheritedOutPort = this.game.queryScalar("InheritOutPort", {child: child.id, parent: head});
        this.game.exec("DeleteInPort", {id: child.id});
        this.game.exec("DeletePath", {id: child.id});
        return inheritedOutPort;
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
        this.game.publishEventNow(new BeltPathRecalculateEvent(x, y, parts));
    }

    /**
     * @private
     * @param {{x: number, y: number, type: number, rampParent: BigInt, disconnectRampChild: BigInt}} options
     */
    _disconnectRampChain(options) {
        if (!options.rampParent || (options.type !== BELT_RAMP_UP && options.type !== BELT_RAMP_DOWN)) {
            this.game.rollback();
            throw new Error("belt error");
        }

        const rampChild = this.game.querySingle("GetBelt", {id: options.disconnectRampChild});
        if (!rampChild || rampChild.type !== options.type) {
            this.game.rollback();
            throw new Error("belt error");
        }

        const distanceX = Math.abs(options.x - rampChild.x);
        const distanceY = Math.abs(options.y - rampChild.y);
        if ((distanceX !== 0 && distanceY !== 0)
            || (Math.max(distanceX, distanceY) - 2) > MAX_UNDERGROUND_LENGTH) {
            this.game.rollback();
            throw new Error("belt error");
        }

        if (options.type === BELT_RAMP_DOWN) {
            const rampBelts = this.game.query("GetRampChildren", {id: options.disconnectRampChild});
            rampBelts.forEach(belt => this._removeBelt(belt.id, true));
        } else {
            const rampBelts = this.game.query("GetRampParents", {id: options.disconnectRampChild});
            rampBelts.forEach(belt => this._removeBelt(belt.id, true));
        }
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
        // is already open and there is nothing to re-link.
        const neighborBelt = this.game.querySingle("GetBelt", {id: upstreamNeighbor});
        if (neighborBelt == null) {
            return;
        }
        const upstreamHead = this._getBeltPathHead(upstreamNeighbor);
        if (upstreamHead === loopHead) {
            // Still one path (an intact loop) — re-linking would recreate the cycle.
            return;
        }

        // Preserve in-flight items across the re-index, mirroring path creation.
        this._stashItems(loopHead);
        this._stashItems(upstreamHead);

        // Re-point the seam head at its upstream neighbor through the same helper
        // creation uses, so parent_id is set by the shared geometry and clients get
        // the BeltUpdateEvent that refreshes the belt's bend.
        this._relinkChild(
            {id: loopHead, x: seamBelt.x, y: seamBelt.y},
            {x: neighborBelt.x, y: neighborBelt.y},
        );

        this.game.exec("CalculateBeltPath", {id: upstreamHead});
        this._absorbChildPath(upstreamHead, {id: loopHead});
        this.game.exec("MaterializeBeltPath", {id: upstreamHead});

        this._unStashItems();
        this.game.exec("FillHeadGap", {id: upstreamHead});

        const head = this.game.querySingle("GetBelt", {id: upstreamHead});
        this._publishPathRecalculate(upstreamHead, head.x, head.y);
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

        // The child lost its upstream parent, so its bend is now straight. Notify
        // clients (null parent → straight) so its sprite is re-rendered, mirroring
        // the BeltUpdateEvent a re-link publishes when a parent changes. The child's
        // tile is immutable, so it's reused from the DetachChild row — no re-query.
        this.game.publishEventNow(new BeltUpdateEvent(child.x, child.y, childId, null, null));
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
        this._reconnectOrphanedRamp(orphanedRamp);

        this.game.end();
    }

    /**
     * The opposite-end ramp of @belt's tunnel (its surviving partner once @belt is
     * deleted), or null for a lone ramp or non-ramp belt. Captured before the
     * deletion mutates the parent_id chain it walks.
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
     * After a deletion orphans a tunnel's surviving ramp, scans its axis for another
     * unpaired ramp now within reach and, if found, rebuilds the tunnel between them
     * (preserving in-flight items through the standard create path). A no-op when the
     * ramp didn't have a partner, no candidate is reachable, or the only candidate
     * sits directly adjacent (a zero-length tunnel, left for the player to place).
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
     * Scans the surviving ramp's axis for the nearest unpaired complementary ramp it
     * can tunnel to (mirroring the client's placement pairing): an exit looks upstream
     * for a free entrance, an entrance downstream for a free exit. Returns that ramp,
     * or null when the path is blocked by a same-type ramp, the gap already holds an
     * underground, the candidate is already paired, or nothing is in range.
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

        // A crossing tunnel's underground in the gap would collide with ours (one
        // underground per tile), so refuse rather than abort the whole removal.
        const gapHasUnderground = rows.some(row =>
            row.type === BELT_UNDERGROUND && row.distance < candidate.distance
        );
        if (gapHasUnderground) {
            return null;
        }

        // Only adopt a free ramp; never steal one already serving its own tunnel.
        const candidatePaired = complementaryType === BELT_RAMP_DOWN
            ? this.game.querySingle("GetDownstreamRamp", {id: candidate.id})
            : this.game.querySingle("GetUpstreamRamp", {id: candidate.id});
        if (candidatePaired !== null) {
            return null;
        }

        const belt = this.game.querySingle("GetBelt", {id: candidate.id});
        return {id: candidate.id, x: belt.x, y: belt.y, type: candidate.type, direction: belt.direction};
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
        this.game.exec("DeleteUnusedPathPorts", {id});
        this.game.exec("DeletePath", {id});
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
        const parent = this.game.querySingle("GetBeltParent", {id});
        const parentX = parent === null ? null : parent.x;
        const parentY = parent === null ? null : parent.y;
        this.game.publishEventNow(new BeltInsertEvent(options.x, options.y, id, options.direction, options.type, parentX, parentY));
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
        this.game.exec("TruncateStashedItems");
        this.game.exec("RecalculateNextGap");
        this.game.exec("RecalculateNextItem");
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
                this.game.exec("DeleteInPort", {id: childPath});
                const port = this.game.queryScalar("InsertPort");
                this.game.exec("UpdateInPort", {id: childPath, port});
                outputPort = port;
            }
        } else {
            outputPort = inheritedOutPort || this.game.queryScalar("InsertPort");
        }

        this.game.exec("UpdateBeltPathPorts", {id, inPort: inputPort, outPort: outputPort});
    }
}
