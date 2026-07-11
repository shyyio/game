import {setupGame} from "@/sdk/test.js";
import {SimEngine} from "@/common/sim/SimEngine.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";
import {Direction} from "@/common/constants.js";

/**
 * The legacy SQLite simulation behind the {@link SimEngine} contract, so a scenario runs against it
 * and the bitECS EcsEngine identically for differential parity testing. Node-only test scaffolding
 * (boots a real in-memory game); the port ids it hands back match EcsEngine's eids because both
 * allocate 1, 2, 3, ... in creation order.
 */
export class SqlEngine extends SimEngine {

    /**
     * @param {AbstractMod[]} [mods]
     */
    constructor(mods=[]) {
        super();
        this.mods = mods;
        this.harness = null;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        this.harness = await setupGame(this.mods);
    }

    /**
     * @private
     * @returns {NodeDatabase}
     */
    get _db() {
        return this.harness.db;
    }

    /**
     * @param {number} [item]
     * @returns {number} the port id
     */
    addPort(item=EMPTY) {
        if (item === EMPTY) {
            return this._db.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
        }
        return this._db.rawScalar(`INSERT INTO Port (item) VALUES (${item}) RETURNING id`);
    }

    /**
     * @param {number} id
     * @returns {number} the port's item, or EMPTY
     */
    portItem(id) {
        const value = this._db.rawScalar(`SELECT item FROM Port WHERE id=${id}`);
        if (value === null || value === undefined) {
            return EMPTY;
        }
        return value;
    }

    /**
     * @param {number} id
     * @param {number} item
     * @returns {void}
     */
    setPortItem(id, item) {
        const value = item === EMPTY ? "NULL" : item;
        this._db.rawExec(`UPDATE Port SET item=${value} WHERE id=${id}`);
    }

    /**
     * @param {{source:number, dest:number, destEmpty?:boolean, managed?:boolean, outputItem?:number, rank?:number}} intent
     * @returns {void}
     */
    submitIntent(intent) {
        const source = intent.source === EMPTY ? "NULL" : intent.source;
        const dest = intent.dest === EMPTY ? "NULL" : intent.dest;
        const destEmpty = intent.destEmpty === true ? 1 : 0;
        const managed = intent.managed === undefined || intent.managed ? 1 : 0;
        const outputItem = intent.outputItem === undefined || intent.outputItem === EMPTY ? "NULL" : intent.outputItem;
        const rank = intent.rank === undefined || intent.rank === EMPTY ? "NULL" : intent.rank;
        this._db.rawExec(`
            INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, managed, output_item, alternatives_rank)
            VALUES (${source}, ${dest}, ${destEmpty}, ${managed}, ${outputItem}, ${rank})
        `);
    }

    /**
     * @returns {void}
     */
    resolvePortTransfer() {
        this.harness.exec("ResolvePortTransfer");
        this.harness.exec("CaptureResolvedSinks");
    }

    /**
     * @returns {void}
     */
    flushSinks() {
        this.harness.exec("FlushResolvedSink");
    }

    /**
     * @returns {void}
     */
    commitTransfers() {
        this.harness.exec("FlushResolvedPortTransferSource");
        this.harness.exec("FlushResolvedPortTransferDestination");
    }

    /**
     * @returns {string}
     */
    resolvedEdges() {
        const rows = this._db.db
            .prepare("SELECT source_id, destination_id FROM ResolvedPortTransfer WHERE source_id IS NOT NULL AND destination_id IS NOT NULL ORDER BY source_id")
            .all();
        return rows.map(row => `${row.source_id}->${row.destination_id}`).join(", ");
    }

    /**
     * Creates a splitter wired to six fresh ports (state 0), inserted directly — no placement.
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    addSplitter() {
        const port = () => this._db.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
        const in_a = port();
        const in_b = port();
        const out_a = port();
        const out_b = port();
        const int_a = port();
        const int_b = port();
        const id = this._db.rawScalar(`
            INSERT INTO Splitter (x, y, direction, in_a_id, in_b_id, out_a_id, out_b_id, int_a_id, int_b_id, state)
            VALUES (0, 0, ${Direction.UP}, ${in_a}, ${in_b}, ${out_a}, ${out_b}, ${int_a}, ${int_b}, 0)
            RETURNING id
        `);
        return {id, in_a, in_b, out_a, out_b, int_a, int_b};
    }

    /**
     * @param {number} id
     * @returns {number} the splitter's round-robin state bit
     */
    splitterState(id) {
        return this._db.rawScalar(`SELECT state FROM Splitter WHERE id=${id}`);
    }

    /**
     * Executes literal SQL, ignoring result rows — for a spec to seed state directly.
     * @param {string} sql
     * @returns {void}
     */
    rawExec(sql) {
        this._db.rawExec(sql);
    }

    /**
     * Runs literal SQL and returns the first column of the first row.
     * @param {string} sql
     * @returns {*}
     */
    rawScalar(sql) {
        return this._db.rawScalar(sql);
    }

    /**
     * Runs literal SQL and returns all result rows.
     * @param {string} sql
     * @returns {object[]}
     */
    rawAll(sql) {
        return this._db.db.prepare(sql).all();
    }

    /**
     * Dispatches a player message through the game, exactly as a client would.
     * @param {AbstractMessage} message
     * @returns {void}
     */
    dispatchMessage(message) {
        this.harness.dispatchMessage(message);
    }

    /**
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        this.harness.tick(phase);
    }
}
