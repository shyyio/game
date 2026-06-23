
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
import {getUndergroundBeltsToCreate} from "./geometry.js";
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
     * Returns a BeltSyncEvent for every belt in the chunk, so a freshly-loaded
     * chunk seeds belts placed before it was viewed. Same payload as a live
     * BeltInsertEvent but a distinct type, so the client seeds them without the
     * placement feedback a real insert would trigger. Underground belts are included
     * (the client index needs them for ramp scans); the draw layer skips drawing them.
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
     * Places one belt and rewires the affected paths around it. A newly placed
     * belt always becomes (or extends) a path head; if it points at an existing
     * belt that belt becomes its downstream "child", and the two paths may merge.
     *
     * @private
     * @param {{x: number, y: number, type: number, direction: Direction, [rampParent]: BigInt, [disconnectRampChild]: BigInt, [chunk]: string}} options
     * @param {boolean} [transaction] - false when called recursively (e.g. underground
     *     segments) so only the outermost call owns the begin/end boundary.
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
     * Inserts the Belt row (computing its upstream parent in SQL) and returns the
     * new id, or null if the placement conflicts with an existing belt. On conflict
     * the transaction is rolled back so no partial state survives.
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
     * Resolves the new belt's path head and its downstream child (the belt it now
     * feeds, if any) in a single query. The child carries derived, named booleans
     * describing the merge topology so callers branch on intent rather than on raw
     * id/chunk comparisons:
     *   - isStandalone: the child was its own path head (no upstream parent in its path)
     *   - hadParent: the child had an upstream parent belt before this placement
     *   - isCrossChunk: the child lies in a different chunk from the new belt
     *   - parentInDifferentChunk: the child's former parent lay in another chunk from the child
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
     * True when the new belt is itself the path head merging with a same-chunk
     * standalone child (a child that was its own head and had no upstream parent).
     * In that case path_indexes don't shift, so items can be transferred directly
     * rather than stashed/recalculated — the fast path.
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
     * Fast path: absorb a same-chunk standalone child into the new head without
     * stashing. BeltPathItem rows move directly via TransferBeltPathItems because
     * their path_indexes are preserved. Invariant: head_gap stays <= length (kept
     * by FillHeadGap after the path is re-materialized).
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
     * General path: the new belt may merge paths, split a child onto a new path
     * (cross-chunk) and/or detach the child from a previous parent. Items along
     * every affected path are stashed before re-materialization and un-stashed
     * after, so positions survive the path_index shift. Invariant: each touched
     * path ends with head_gap <= length via FillHeadGap.
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
     * Folds the child's path into `head`: head inherits the child's output port
     * (its downstream link), then the redundant child path and its input port are
     * removed. Returns the inherited out_port_id, used to seed head's ports when
     * head's path was freshly created.
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
     * Removes one belt and rebuilds the paths it leaves behind: its former upstream
     * parent loses its tail, and its former downstream child becomes a new path head.
     * Ramp belts cascade to remove the whole underground tunnel they anchor.
     *
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

        this._stashOutputItem(id);

        let {childId, parentId} = this._eraseBelt(id);
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
            this._splitOrphanedChildPath(childId);
        }

        if (parentPathHead) {
            this._finalizeParentPath(parentPathHead, belt, fillHeadGap);
        }

        if (childId && childId !== parentPathHead) {
            fillHeadGap.push(childId);
        }

        if (!recursive) {
            this._finalizeRemoval(fillHeadGap, loopSeam);
        }
    }

    /**
     * Describes @id's path when it is a loop: its head and the belt physically
     * upstream of that head (the wrap-around feeder). Returns null when the path is
     * not a loop. Capturing the feeder here lets _healLoopSeam reuse it instead of
     * re-deriving the geometry after the deletion has mutated the paths.
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
     * Re-links a loop seam left dangling by a deletion: the recorded head still has
     * no parent but is now physically fed by a belt in a *different* path (the cycle
     * is broken). Re-point the head at that upstream neighbor and fold its path into
     * the neighbor's, so the remainder is the single run a fresh build would produce.
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
     * Cascades a ramp deletion through its underground tunnel: deleting a RAMP_DOWN
     * removes the undergrounds downstream of it; deleting a RAMP_UP removes those
     * upstream. Once the tunnel is gone the corresponding child/parent link no
     * longer needs separate path handling, so it is cleared.
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
     */
    _splitOrphanedChildPath(childId) {
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
     * Top-level wrap-up: restore all stashed items, refill the head_gap of every
     * path touched by the cascade, re-link any broken loop seam, then commit.
     * Invariant: fillHeadGap must hold no duplicates, or a path would be refilled
     * twice and break head_gap <= length.
     * @private
     * @param {BigInt[]} fillHeadGap
     * @param {{head: BigInt, upstreamNeighbor: BigInt}|null} loopSeam
     */
    _finalizeRemoval(fillHeadGap, loopSeam) {
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

        this.game.end();
    }

    // ---- Helpers ----

    /**
     * Removes all DB rows for a belt and returns the IDs of its former child and parent.
     * @private
     * @param {BigInt} id
     * @returns {{childId: BigInt|null, parentId: BigInt|null}}
     */
    _eraseBelt(id) {
        const childId = this.game.queryScalar("DetachChild", {id});
        this.game.exec("DeleteItems", {id});
        this.game.exec("UnassignBeltPath", {id});
        this.game.exec("DeleteUnusedPathPorts", {id});
        this.game.exec("DeletePath", {id});
        this.game.exec("ClearSolitaryBeltPortItem", {id});
        this.game.exec("NullifyPathTail", {id});
        const parentId = this.game.queryScalar("DeleteBeltRow", {id});
        return {childId, parentId};
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
