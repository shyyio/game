import {GameBackend} from "@/backend/GameBackend.js";
import initSqlJs from "sql.js";
import wasmFile from "../assets/sql-wasm.wasm?url";
import {get} from "idb-keyval";
import {
    BeltDeleteEvent,
    BeltInsertEvent,
    BeltPathDeleteEvent,
    BeltPathItemDeleteEvent,
    BeltPathItemInsertEvent,
    BeltPathItemUpdateEvent,
    BeltPathRecalculateEvent,
    BeltPathUpdateEvent,
    BeltUpdateEvent,
    ObjectDeleteEvent,
    ObjectInsertEvent
} from "@/events.js";
import {getMedian, getStandardDeviation} from "@/mathUtil.js";
import {getChunk, gzipCompress, rotate} from "@/util.js";
import {getUndergroundBeltsToCreate} from "@/backend/beltLogic.js";
import {
    BeltType,
    Direction,
    EventType,
    GameObject, ItemType,
    MAX_UNDERGROUND_LENGTH
} from "@/backend/constants.js";
import {DbSchema} from "@/backend/schema.js";
import {RS} from "@/backend/ruleset.js";
import {TickPhase} from "@/backend/core.js";

BigInt.toJSON = function() { return this.toString(); };

const DB_CONFIG = {useBigInt: true};

function formatArgs(args) {
    const _args = {};

    Object.entries(args).forEach(([key, value]) => {
        if (typeof value === "bigint") {
            _args[`@${key}`] = value.toString();
        } else {
            _args[`@${key}`] = value;
        }
    });

    return _args;
}

const BIGINT_COLS = new Set(["id", "parent", "belt", "path", "child", "parent_path", "head", "tail"]);

function formatRow(row) {

    Object.entries(row).forEach(([key, value]) => {
        if (!BIGINT_COLS.has(key) && typeof value === "bigint") {
            row[key] = Number(value);
        }
    });

    return row;
}

export class BrowserGameBackend extends GameBackend {

    constructor() {
        super();

        this.listeners = {};
        Object.values(EventType).forEach(logType => {
            this.listeners[logType] = [];
        })

        this.profiling_data = {};

        /**
         * @type {{string: string}}
         */
        this.statements = {};

        this.debug = false;
    }

    printProfilingData() {
        const stmts = []

        Object.entries(this.profiling_data).forEach(([name, times]) => {
            if (times.length === 0) {
                return;
            }

            const row = {
                name: name,
                median: getMedian(times),
                stdDev: getStandardDeviation(times),
                count: times.length
            };

            if (row.median > 0.001) {
                stmts.push(row);
            }
        });

        stmts.sort((a, b) => b.median - a.median);

        stmts.forEach(stmt => {
            console.log(`${stmt.name.padEnd(30, " ")}x${stmt.count}, ${stmt.median.toFixed(4)} +/- ${stmt.stdDev.toFixed(4)}`,);
        });
    }

    exec(sql) {
        const stmt = this.db.prepare(sql);

        let row = null
        if (stmt.step()) {
            row = stmt.get();
        }

        stmt.free();

        if (row) {
            return row[0];
        }
        return undefined;
    }

    execPretty(sql) {
        const stmt = this.db.prepare(sql);
        const result = [];

        while (stmt.step()) {
            result.push(stmt.getAsObject());
        }

        stmt.free();

        return result;
    }

    async init() {

        this.schema = new DbSchema(RS);

        const SQL = await initSqlJs({
            // https://sql.js.org/dist/sql-wasm.wasm
            locateFile: file => wasmFile
        });

        const dbData = await get("db");
        if (dbData === undefined) {
            /**
             * @type {Database}
             */
            this.db = new SQL.Database(DB_CONFIG);
            this.schema.pragma.forEach(stmt => this.db.run(stmt));
            this.schema.initSchema.forEach(stmt => this.db.run(stmt));
        } else {
            /**
             * @type {Database}
             */
            this.db = new SQL.Database(DB_CONFIG);
            this.schema.pragma.forEach(stmt => this.db.run(stmt));
        }

        this._initdb();
    }

    /**
     * @param {string} name
     * @param [args] {*}
     * @private
     */
    _execStatement(name, args) {

        const _stmt = this.statements[name];

        if (_stmt === undefined) {
            debugger
        }

        if (args) {
            _stmt.bind(formatArgs(args));
        }

        if (this.debug) {
            console.log(name + (args ? " " + JSON.stringify(args) : ""));
        }

        const startTime = performance.now();
        _stmt.step();
        _stmt.reset();
        const duration = performance.now() - startTime;

        this.profiling_data[name].push(duration);
    }

    /**
     * @param name {string}
     * @param [args] {*}
     * @returns {*[]}
     * @private
     */
    _queryStatement(name, args) {
        const stmt = this.statements[name];

        if (args) {
            stmt.bind(formatArgs(args));
        }

        const result = [];

        if (this.debug) {
            console.log(name + (args ? " " + JSON.stringify(args) : "") + " ?");
            // console.log(stmt)
        }

        const startTime = performance.now();
        while (stmt.step()) {
            result.push(formatRow(stmt.getAsObject(null, DB_CONFIG)));
        }
        const duration = performance.now() - startTime;
        this.profiling_data[name].push(duration);

        return result;
    }

    /**
     * @param name {string}
     * @param [args] {*}
     * @returns {*}
     * @private
     */
    _queryStatementSingle(name, args) {
        const result = this._queryStatement(name, args);

        if (result.length === 0) {
            return null;
        }

        return result[0];
    }

    /**
     * @param name {string}
     * @param [args] {*}
     * @returns {*}
     * @private
     */
    _queryStatementScalar(name, args) {
        const result = this._queryStatement(name, args);

        if (result.length === 0) {
            return null;
        }

        return Object.values(result[0])[0];
    }

    _initdb() {
        this.schema.pragma.forEach(stmt => this.db.run(stmt));
        this.schema.tempSchema.forEach(stmt => this.db.run(stmt));

        Object.entries(this.schema.preparedStatements).forEach(([name, stmt]) => {
            try {
                this.statements[name] = this.db.prepare(stmt);
            } catch (e) {
                console.log(name, stmt);
                console.error(e.message);
                debugger
            }

            this.profiling_data[name] = [];
        });

        this.db.create_function("on_belt_insert", (id, x, y, direction, type, parentX, parentY) => {
            this._on(EventType.BELT_INSERT, new BeltInsertEvent(BigInt(id), x, y, direction, type, parentX, parentY));
        });

        this.db.create_function("on_belt_update", (id, parentX, parentY) => {
            this._on(EventType.BELT_UPDATE, new BeltUpdateEvent(BigInt(id), parentX, parentY));
        });

        this.db.create_function("on_belt_delete", (id) => {
            this._on(EventType.BELT_DELETE, new BeltDeleteEvent(BigInt(id)));
        });

        this.db.create_function("on_belt_path_delete", (id) => {
            this._on(EventType.BELT_PATH_DELETE, new BeltPathDeleteEvent(BigInt(id)));
        });

        this.db.create_function("on_belt_path_update", (id, headGap, outputItem) => {
            this._on(EventType.BELT_PATH_UPDATE, new BeltPathUpdateEvent(BigInt(id), headGap, outputItem));
        });
        
        this.db.create_function("on_belt_path_item_delete", (id) => {
            this._on(EventType.BELT_PATH_ITEM_DELETE, new BeltPathItemDeleteEvent(BigInt(id)));
        });

        this.db.create_function("on_belt_path_item_update", (id, length) => {
            this._on(EventType.BELT_PATH_ITEM_UPDATE, new BeltPathItemUpdateEvent(BigInt(id), length));
        });
        
        this.db.create_function("on_belt_path_item_insert", (path, id, type, length, flag) => {
            this._on(EventType.BELT_PATH_ITEM_INSERT, new BeltPathItemInsertEvent(BigInt(path), BigInt(id), type, length, flag));
        });

        this.db.create_function("on_object_insert", (name, id, x, y, direction) => {
            this._on(EventType.OBJECT_INSERT, new ObjectInsertEvent(name, BigInt(id), x, y, direction));
        });

        this.db.create_function("on_object_delete", (name, id) => {
            this._on(EventType.OBJECT_INSERT, new ObjectDeleteEvent(name, BigInt(id)));
        });

        this.db.create_function("console_log", (message) => {
            if (this.debug) {
                console.log("\t" + message);
            }
        });

        this.schema.triggers.forEach(trigger => this.db.run(trigger));
    }


    /**
     * @param type {EventType}
     * @param callback {BackendEventCallback}
     */
    on(type, callback) {
        this.listeners[type].push(callback);
    }

    /**
     * @param type {EventType}
     * @param event {GameEvent}
     * @private
     */
    _on(type, event) {
        this.listeners[type].forEach(callback => {
            try {
                callback(event)
            } catch (e) {
                console.error(e)
            }
        });
    }

    _begin() {
        this._execStatement("Begin");
    }

    _rollback() {
        this._execStatement("Rollback");
    }

    _end() {
        this._execStatement("End");
    }

    /**
     * @param objectType {GameObject}
     * @param options {object}
     */
    createGameObject(objectType, options) {

        if (options.hasOwnProperty("type")) {
            debugger
        }

        switch (objectType) {
            case GameObject.BELT:
                options.type = BeltType.NORMAL;
                return this._createBelt(options);
            case GameObject.RAMP_DOWN:
                options.type = BeltType.RAMP_DOWN;
                return this._createBelt(options);
            case GameObject.RAMP_UP:
                options.type = BeltType.RAMP_UP;
                return this._createBelt(options);
            default:
                this._createGameObject(objectType, options);
        }
    }

    /**
     * @param point {Vec}
     * @param offset {Vec}
     * @returns {BigInt}
     */
    _getInputPort(point, offset) {
        switch (point.direction) {
            case Direction.UP:
                return this._queryStatementScalar("GetInPortUp", {x: point.x + offset.x, y: point.y + offset.y});
            case Direction.RIGHT:
                return this._queryStatementScalar("GetInPortRight", {x: point.x + offset.x, y: point.y + offset.y});
            case Direction.DOWN:
                return this._queryStatementScalar("GetInPortDown", {x: point.x + offset.x, y: point.y + offset.y});
            case Direction.LEFT:
                return this._queryStatementScalar("GetInPortLeft", {x: point.x + offset.x, y: point.y + offset.y});
        }
    }

    /**
     * @param point {Vec}
     * @param offset {Vec}
     * @returns {BigInt}
     */
    _getOutputPort(point, offset) {
        switch (offset.direction) {
            case Direction.UP:
                return this._queryStatementScalar("GetOutPortUp", {x: point.x + offset.x, y: point.y + offset.y});
            case Direction.RIGHT:
                return this._queryStatementScalar("GetOutPortRight", {x: point.x + offset.x, y: point.y + offset.y});
            case Direction.DOWN:
                return this._queryStatementScalar("GetOutPortDown", {x: point.x + offset.x, y: point.y + offset.y});
            case Direction.LEFT:
                return this._queryStatementScalar("GetOutPortLeft", {x: point.x + offset.x, y: point.y + offset.y});
        }
    }

    /**
     * @param name {GameObject}
     * @param options {object}
     * @param options.x {number}
     * @param options.y {number}
     * @param options.direction {Direction}
     * @private
     */
    _createGameObject(name, options) {

        this._begin();

        RS.objectTiles(name, options.x, options.y, options.direction).forEach(p => {
            if (this._queryStatementScalar("IsOccupied", {x: p.x, y: p.y}) === 1) {
                this._rollback();
                debugger
                return;
            }
        })

        const args = {
            x: options.x,
            y: options.y,
            direction: options.direction
        };

        Object.assign(args, this.getOutputPorts(name, args, true))
        Object.assign(args, this.getInputPorts(name, args, true))
        Object.assign(args, this.getInternalPorts(name, args, true))

        this._execStatement(`Insert${name}`, args);

        this._end();
    }

    /**
     * @param name {GameObject}
     * @param vec {Vec}
     * @param [createMissing] {boolean}
     * @returns {Object.<string: BigInt>}
     */
    getOutputPorts(name, vec, createMissing) {

        const ports = {};

        RS.definitions[name].inputPorts.forEach((def) => {
            const port = this._getOutputPort(vec, rotate(def, vec.direction));
            if (port) {
                ports[def.name] = port;
            } else if (createMissing) {
                ports[def.name] = this._queryStatementScalar("InsertPort");
            }
        });

        return ports;
    }

    /**
     * @param name {GameObject}
     * @param vec {Vec}
     * @param [createMissing] {boolean}
     * @returns {Object.<string: BigInt>}
     */
    getInputPorts(name, vec, createMissing) {

        const ports = {};

        RS.definitions[name].outputPorts.forEach((def) => {
            const port = this._getInputPort(vec, rotate(def, vec.direction));
            if (port) {
                ports[def.name] = port;
            } else if (createMissing) {
                ports[def.name] = this._queryStatementScalar("InsertPort");
            }
        });

        return ports;
    }

    /**
     * @param name {GameObject}
     */
    getInternalPorts(name) {

        const ports = {};

        RS.definitions[name].internalPorts.forEach((def) => {
            ports[def.name] = this._queryStatementScalar("InsertPort");
        });

        return ports;
    }

    /**
     * @param objectType {GameObject}
     * @param id {BigInt}
     */
    removeGameObject(objectType, id) {
        switch (objectType) {
            case GameObject.BELT:
                return this._removeBelt(id);
            default:
                debugger;
        }
    }

    async debugAddItem() {
        this.db.run("UPDATE Port SET item=1 WHERE id=1;");
        this.db.run("UPDATE Port SET item=1 WHERE id=3;");
        console.log("2")
    }

    async debugPrintDbSize() {
        this.db.run("VACUUM;");

        const pageCount = this.db.exec("PRAGMA page_count;")[0].values[0][0];
        const pageSize = this.db.exec("PRAGMA page_size;")[0].values[0][0];
        const size = pageCount * pageSize;

        console.log(`${size/1024}kB (${(size/(1024*1024)).toFixed(2)}MB)`)
    }

    exportDb() {
        this.db.run("VACUUM;");
        const data = this.db.export();
        this._initdb();

        gzipCompress(data).then(blob => {
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "save.sqlite3.gz";
            document.body.appendChild(a);
            a.click();

            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    /**
     * @param id {BigInt}
     * @private
     */
    _stashItems(id) {
        this._execStatement("StashItems", {id});
        this._execStatement("DeleteItems", {id});
    }

    /**
     * @param id {BigInt}
     * @private
     */
    _stashOutputItem(id) {
        this._execStatement("StashOutputItem", {id});
        this._execStatement("RemoveOutputItem", {id});
    }

    _unStashOutputItem() {
        this._execStatement("UnStashOutputItem");
        this._execStatement("TruncateStashedOutputItem");
    }

    /**
     * @private
     */
    _unStashItems() {
        this._execStatement("UnStashItems");
        this._execStatement("TruncateStashedItems")
    }

    /**
     * @param id {BigInt}
     * @returns {BigInt[]}
     */
    _getPath(id) {
        return this._queryStatement("GetBeltPath", {id}).map(row => row.id);
    }

    // test helpers

    tickBeltPath() {
        this.tick(TickPhase.SUBMIT_INTENTS);
        this.tick(TickPhase.RESOLVE_TRANSFERS);
        this.tick(TickPhase.POST_RESOLVE);
    }

    //

    /**
     * @param phase {TickPhase}
     */
    tick(phase) {
        this.schema.tickPhases[phase].forEach(op => {
            try {
                this._execStatement(op.statementName);
            } catch (ex) {
                debugger
                throw ex;
            }
        });
    }

    _populateBeltPathPorts(id) {
        const head = this._queryStatementSingle("GetBelt", {id});
        const tail = this._queryStatementSingle("GetTail", {id});

        const outputPorts = this.getOutputPorts(GameObject.BELT, head);

        if (Object.values(outputPorts).length > 1) {
            // FIXME: Choose oldest port?
            debugger
        }
        const inputPort = Object.values(outputPorts)[0] || this._queryStatementScalar("InsertPort");

        const inputPorts = this.getInputPorts(GameObject.BELT, tail);
        let outputPort = Object.values(inputPorts)[0];
        if (outputPort) {
            // If outputPort belongs to a BeltPath, "steal" its input port:
            // TODO: Update getInputPorts so that it returns the owner object
            const childPath = this._queryStatementScalar("GetBeltPathPortOwner", {id: outputPort});

            if (childPath) {
                this._execStatement("DeleteInPort", {id: childPath});
                const port = this._queryStatementScalar("InsertPort");
                this._execStatement("UpdateInPort", {id: childPath, port: port});
                outputPort = port;
            }
        } else {
            outputPort = this._queryStatementScalar("InsertPort");
        }

        // Delete existing port
        this._execStatement("DeleteUnusedPathPorts", {id});

        this._execStatement("UpdateBeltPathPorts", {id, inPort: inputPort, outPort: outputPort})
    }


    /**
     * @param options {{x: Number, y: Number, type: BeltType, direction: Direction, [rampParent]: BigInt, [disconnectRampChild]: BigInt, [chunk]: string}}
     * @param tnx {boolean}
     * @private
     */
    _createBelt(options, tnx=true){

        options.chunk = getChunk(options.x, options.y);

        if (tnx) {
            this._begin();
        }

        // =========== Disconnect existing ramp =====
        if (options.disconnectRampChild) {
            if (!options.rampParent || (options.type !== BeltType.RAMP_UP && options.type !== BeltType.RAMP_DOWN)) {
                // TODO: Add test case for this
                this._rollback();
                throw new Error("belt error");
            }

            const rampChild = this._queryStatementSingle("GetBelt", {id: options.disconnectRampChild});
            const distanceX = Math.abs(options.x - rampChild.x);
            const distanceY = Math.abs(options.y - rampChild.y);

            if ((distanceX !== 0 && distanceY !== 0)
                || (Math.max(distanceX, distanceY) - 2) > MAX_UNDERGROUND_LENGTH
                || !rampChild
                || rampChild.type !== options.type
            ) {
                this._rollback();
                throw new Error("belt error");
            }

            // TODO: Check that 'disconnectRampChild' is valid. Same chunk? or something
            // TODO: Add test cases for that.
            // TODO: Does this still work if this is cross-chunk?
            if (options.type === BeltType.RAMP_DOWN) {
                this._queryStatement("GetRampChildren", {id: options.disconnectRampChild})
                    .forEach(child => this._removeBelt(child.id, true));
            } else {
                this._queryStatement("GetRampParents", {id: options.disconnectRampChild})
                    .forEach(child => this._removeBelt(child.id, true));
            }
        }

        // =========== Create underground belts =====
        if (options.rampParent && (options.type === BeltType.RAMP_UP || options.type === BeltType.RAMP_DOWN)) {
            const rampParent = this._queryStatementSingle("GetBelt", {id: options.rampParent});
            const undergrounds = getUndergroundBeltsToCreate(rampParent, options);

            undergrounds.forEach(underground =>
                this._createBelt({
                    x: underground.x,
                    y: underground.y,
                    direction: options.direction,
                    type: BeltType.UNDERGROUND
                }, false)
            );
        }

        let id;
        try {
            id = this._queryStatementScalar("InsertBelt", options);
        } catch (e) {
            if (!e.message.includes("UNIQUE")) { /* FIXME */ debugger }
            this._rollback();
            throw new Error("belt error");
        }

        /**
         * @type {{id: BigInt, path: BigInt, oldParent: BigInt, chunk: string, oldParentChunk: string}}
         */
        const child = this._queryStatementSingle("GetBeltChild", options);
        const head = this._getBeltPathHead(id)

        let oldParentPathHead = null;

        // =========== Handle child belt =====
        if (child !== null) {
            this._execStatement("UpdateBeltChild", {id: child.id});

            this._stashItems(child.id);

            if (child.path === child.id) {
                // Child is head, stash its path items
                this._stashOutputItem(child.id);
            }

            // If the new child had a parent, recalculate its path.
            if (child.oldParent) {
                oldParentPathHead = this._queryStatementScalar("GetExistingBeltPathHead", {id: child.oldParent});
                this._stashItems(oldParentPathHead)
                this._stashOutputItem(oldParentPathHead);

                this._execStatement("CalculateBeltPath", {id: oldParentPathHead});
                // Temporarily invalidate the path because the downstream belts still point to
                // the old parent's path.
                this._execStatement("InvalidatePath", {id: oldParentPathHead});
            }

            // If child is in a different chunk, child.id is now a new path
            if (child.chunk !== options.chunk) {
                const created = this._queryStatementScalar("InsertBeltPath", {id: child.id});
                this._execStatement("CalculateBeltPath", {id: child.id});
                this._execStatement("MaterializeBeltPath", {id: child.id});

                if (created) {
                    this._populateBeltPathPorts(child.id);
                }
                this._on(EventType.BELT_PATH_RECALCULATE, new BeltPathRecalculateEvent(this._getPath(child.id)));
            }
        }

        if (child !== null || head !== id) {
            this._execStatement("StashGap", {id});
            this._stashItems(head);
        }

        const createdNewPath = this._queryStatementScalar("InsertBeltPath", {id: head});
        this._execStatement("CalculateBeltPath", {id: head});

        // =========== Delete old path =====

        if (child !== null && (child.oldParent === null || child.oldParentChunk !== child.chunk) && child.id !== head && child.chunk === options.chunk) {
            // If child is the head of a path, delete the path before materializing the new path
            // Inherit out port
            // this._execStatement("Delete")
            this._execStatement("DeleteOutPort", {id: head});
            this._execStatement("InheritOutPort", {child: child.id, parent: head});
            this._execStatement("DeletePath", {id: child.id});
        }

        // =========== Materialize paths =====
        this._execStatement("MaterializeBeltPath", {id: head});
        if (createdNewPath) {
            this._populateBeltPathPorts(head);
        }
        this._on(EventType.BELT_PATH_RECALCULATE, new BeltPathRecalculateEvent(this._getPath(head)));

        if (oldParentPathHead) {
            this._execStatement("MaterializeBeltPath", {id: oldParentPathHead});
            this._on(EventType.BELT_PATH_RECALCULATE, new BeltPathRecalculateEvent(this._getPath(oldParentPathHead)));
        }

        // =========== Un-stash ============
        this._unStashItems();
        // console.log(
        //     this.execPretty("SELECT * FROM BeltPath")
        // )
        // console.log(
        //     this.execPretty("SELECT * FROM BeltPathItem")
        // )
        if (oldParentPathHead) {
            this._execStatement("FillHeadGap", {id: oldParentPathHead});
        }
        this._execStatement("FillHeadGap", {id: head});

        if (child !== null && (child.oldParent || child.path === child.id)) {
            this._unStashOutputItem();
            // TODO: Add test case for this...
            this._execStatement("FillHeadGap", {id: child.id});
        }

        if (tnx) {
            this._end();
        }
    }

    /**
     * @param id {BigInt}
     * @param [recursive] {boolean}
     * @param [fillHeadGap] {BigInt[]}
     * @private
     */
    _removeBelt(id, recursive= false, fillHeadGap = []) {
        if (!recursive) {
            this._begin();
        }

        this._stashOutputItem(id);

        const belt = this._queryStatementSingle("GetBelt", {id});
        if (belt.type === BeltType.UNDERGROUND && !recursive) {
            this._end();
            throw new Error("Cannot manually delete underground belt.")
        }

        let childId = this._queryStatementScalar("DetachBelt", {id});
        let parentId = this._queryStatementScalar("DeleteBelt", {id});

        // Delete underground belts when a ramp is deleted
        if (belt.type === BeltType.RAMP_DOWN) {
            this._queryStatement("GetRampChildren", {id: childId})
                .forEach(child => {
                    this._removeBelt(child.id, true, fillHeadGap);
                    childId = null;
                });
        } else if (belt.type === BeltType.RAMP_UP) {
            this._queryStatement("GetRampParents", {id: parentId})
                .forEach(parent => {
                    this._removeBelt(parent.id, true, fillHeadGap)
                    parentId = null;
                });
        }

        let headOfParentPath = null;
        if (parentId) {
            // If the belt we just delete had a parent, recalculate its path
            headOfParentPath = this._getBeltPathHead(parentId);
            this._execStatement("InsertBeltPath", {id: headOfParentPath});
            this._stashItems(headOfParentPath);
            this._stashOutputItem(headOfParentPath);
            this._execStatement("CalculateBeltPath", {id: headOfParentPath});
            // Temporarily invalidate the path because the downstream path still points to
            // the old parent's path.
            this._execStatement("InvalidatePath", {id: headOfParentPath});

        }

        if (childId && childId !== headOfParentPath) {
            // If the belt we just delete had a child, recalculate its path
            const created = this._queryStatementScalar("InsertBeltPath", {id: childId});
            this._stashItems(childId);
            this._execStatement("CalculateBeltPath", {id: childId});

            this._execStatement("MaterializeBeltPath", {id: childId});

            if (created) {
                this._populateBeltPathPorts(childId);
            }
        }

        if (headOfParentPath) {
            // We can now materialize the path, after the child downstream path is ready
            fillHeadGap.push(headOfParentPath);
            this._execStatement("MaterializeBeltPath", {id: headOfParentPath});
            this._on(EventType.BELT_PATH_RECALCULATE, new BeltPathRecalculateEvent(this._getPath(headOfParentPath)));
        }

        if (childId) {
            fillHeadGap.push(childId);
        }

        if (!recursive) {
            this._unStashItems();
            this._unStashOutputItem();

            if (new Set(fillHeadGap).size !== fillHeadGap.length) { /* FIXME */ debugger }

            fillHeadGap.forEach(id => {
                this._execStatement("FillHeadGap", {id});
            });

            this._end();
        }
    }


    /**
     * @param id {BigInt}
     */
    _getBeltPathHead(id) {
        const result = this._queryStatement("GetBeltPathHead", {id});

        if (result.length === 0) {
            return null;
        }

        return result[result.length - 1].id;
    }
}
