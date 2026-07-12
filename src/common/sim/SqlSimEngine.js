import {SimEngine} from "@/common/sim/SimEngine.js";

/**
 * The production {@link SimEngine} over the legacy SQL tick pipeline: each phase runs the prepared
 * statements the schema registered for it, in order. This is the seam the live Game drives sim
 * through, so a bitECS-backed engine can later take over phase by phase behind the same contract.
 */
export class SqlSimEngine extends SimEngine {

    /**
     * @param {AbstractDatabase} database
     */
    constructor(database) {
        super();
        this.db = database;
    }

    /**
     * The database is initialized by its owner (Game), so there is nothing to do here.
     * @returns {Promise<void>}
     */
    async init() {
    }

    /**
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        this.db.schema.tickPhases[phase].forEach(statement => {
            this.db.exec(statement.statementName);
        });
    }

    /**
     * @returns {void}
     */
    debugInsertItem() {
        this.db.rawExec("UPDATE Port SET item = 1 WHERE id = (SELECT in_port_id FROM BeltPath WHERE id = (SELECT MIN(id) FROM BeltPath))");
    }
}
