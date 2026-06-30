import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {upstreamPorts, downstreamPorts} from "@/common/portUtils.js";
import {CHUNK_KEY_SQL} from "@/common/DatabaseSchema.js";

/**
 * Sim-side create/remove/sync/schema/statements for a port-sharing object placed by a
 * CreateObjectMessage; a mod composes one per object type. (Belts are bespoke; splitters/machines fit.)
 */
export class EasyObjectPlacement {

    /**
     * @param {ObjectDefinition} definition - its `table` names the object's table; its `stateColumns`
     *     are extra non-port columns (e.g. a recipe's `inventory`/`cooldown`) that take DB defaults on insert
     */
    constructor(definition) {
        this.table = definition.table;
        this.definition = definition;
        this._stateColumns = definition.stateColumns;
        // All port columns, in insert order: inputs, then outputs, then internals.
        this._portColumns = [
            ...definition.inputPorts,
            ...definition.outputPorts,
            ...definition.internalPorts,
        ].map(port => port.column);
        // Rendered out-port columns, in the order their ids ride insert/sync events.
        this._renderedColumns = definition.outputPorts
            .filter(port => port.render)
            .map(port => port.column);
    }

    /**
     * The rendered out-port ids, in render order, from an insert's port map or a synced DB row.
     * @param {Object.<string, BigInt>} source
     * @returns {BigInt[]}
     * @private
     */
    _renderedPortIds(source) {
        return this._renderedColumns.map(column => source[column]);
    }

    /**
     * The object's table: id/x/y/direction, a derived `chunk`, one Port column per port (ON DELETE
     * SET NULL), any extra `stateColumns`, and the (x,y) + chunk indexes.
     * @returns {string}
     */
    get schema() {
        const columns = [
            ...this._portColumns.map(column => `${column} INT REFERENCES Port(id) ON DELETE SET NULL`),
            ...this._stateColumns,
        ].map(column => `        ${column}`).join(",\n");
        return `
            CREATE TABLE ${this.table} (
                id INTEGER PRIMARY KEY,
                x INT NOT NULL,
                y INT NOT NULL,
                direction INT NOT NULL,
                chunk TEXT GENERATED ALWAYS AS (${CHUNK_KEY_SQL}) VIRTUAL,
                ${columns}
            );

            CREATE UNIQUE INDEX ${this.table}_x_y ON ${this.table}(x, y);

            -- Find this object's rows in watched chunks directly (chunk sync, port-item capture).
            CREATE INDEX ${this.table}_chunk ON ${this.table}(chunk);
        `;
    }

    /**
     * The Insert/Delete/Get/GetInChunk statements for this table, generated from its port columns
     * (each `<portName>_id`). A mod merges these into its `statements`.
     * @returns {Object.<string, string>}
     */
    get statements() {
        const insertCols = ["id", "x", "y", "direction", ...this._portColumns].join(", ");
        const insertVals = ["CAST(@id AS INT)", "@x", "@y", "@direction", ...this._portColumns.map(column => `@${column}`)].join(", ");
        const selectCols = ["id", "x", "y", "direction", ...this._portColumns].join(", ");
        const returningCols = ["x", "y", ...this._portColumns].join(", ");
        return {
            [`Insert${this.table}`]: `
                INSERT INTO ${this.table} (${insertCols})
                VALUES (${insertVals})
                RETURNING id;`,
            [`Delete${this.table}`]: `
                DELETE FROM ${this.table}
                WHERE id = CAST(@id AS INT)
                RETURNING ${returningCols};`,
            [`Get${this.table}`]: `SELECT id FROM ${this.table} WHERE id = CAST(@id AS INT);`,
            [`Get${this.table}InChunk`]: `
                SELECT ${selectCols}
                FROM ${this.table} INDEXED BY ${this.table}_chunk
                WHERE chunk = @chunk;`,
        };
    }

    /**
     * Routes a placement message: Create<T> places one; the broadcast DeleteObjectMessage removes
     * one only if the id is ours.
     * @param {Game} game
     * @param {AbstractMessage} message
     * @returns {void}
     */
    handleMessage(game, message) {
        if (message instanceof CreateObjectMessage && message.typeId === this.definition.typeId) {
            this._create(game, {x: message.x, y: message.y, direction: message.direction});
        } else if (message instanceof DeleteObjectMessage) {
            if (game.querySingle(`Get${this.table}`, {id: message.id}) !== null) {
                this._remove(game, message.id);
            }
        }
    }

    /**
     * Every object of this type in a chunk, as sync events for a newly-subscribed client.
     * @param {Game} game
     * @param {string} chunk
     * @returns {AbstractEvent[]}
     */
    chunkSyncEvents(game, chunk) {
        return game.query(`Get${this.table}InChunk`, {chunk}).map(row =>
            new ObjectSyncEvent(
                this.definition.typeId,
                row.id,
                row.x,
                row.y,
                row.direction,
                this._renderedPortIds(row),
            ));
    }

    /**
     * Places the object, adopting shared ports from neighbours (fresh ports for a missing side or an
     * internal port). Rejects a geometry that spans chunks or overlaps an occupant.
     * @param {Game} game
     * @param {{x: number, y: number, direction: Direction}} options
     * @returns {void}
     * @private
     */
    _create(game, options) {
        const {x, y, direction} = options;
        if (this.definition.geometry.spansChunks(x, y, direction)) {
            console.warn(`Create${this.table} ignored: geometry spans chunks at`, x, y);
            return;
        }

        game.begin();

        // The tool blocks overlaps client-side; reaching here means a malicious or desynced client.
        const occupied = this.definition.geometry.tiles(direction).some(cell =>
            game.queryScalar("IsOccupied", {
                x: x + cell.x,
                y: y + cell.y,
                layer: this.definition.occupancyLayer,
            }) !== null
        );
        if (occupied) {
            console.warn(`Create${this.table} ignored: geometry occupied at`, x, y);
            game.rollback();
            return;
        }

        let id;
        let ports;
        try {
            const inPorts = upstreamPorts(game, this.table, options, true);
            const outPorts = downstreamPorts(game, this.table, options, true);
            const internal = {};
            this.definition.internalPorts.forEach(port => {
                internal[port.column] = game.queryScalar("InsertPort");
            });
            ports = {...inPorts, ...outPorts, ...internal};

            id = game.queryScalar(`Insert${this.table}`, {
                id: game.queryScalar("AllocateObjectId"),
                x,
                y,
                direction,
                ...ports,
            });
        } catch (e) {
            game.rollback();
            const msg = String(e);
            if (msg.includes(`${this.table}.x`) && msg.includes(`${this.table}.y`)) {
                console.warn(`Create${this.table} ignored: object already exists at`, x, y);
                return;
            }
            throw e;
        }

        game.end();
        game.publishEventNow(new ObjectInsertEvent(
            this.definition.typeId,
            id,
            x,
            y,
            direction,
            this._renderedPortIds(ports),
        ));
    }

    /**
     * Removes the object and drops any of its ports no surviving object still shares.
     * @param {Game} game
     * @param {BigInt} id
     * @returns {void}
     * @private
     */
    _remove(game, id) {
        game.begin();

        const row = game.querySingle(`Delete${this.table}`, {id});
        if (row === null) {
            console.warn(`Delete${this.table} ignored: no object with id`, id);
            game.rollback();
            return;
        }

        // The row is gone, so each of its ports is dropped unless a surviving object still shares it.
        this._portColumns.forEach(column => {
            if (row[column] !== null) {
                game.exec("DeletePortIfUnreferenced", {port: row[column]});
            }
        });

        game.end();
        game.publishEventNow(new ObjectDeleteEvent(this.definition.typeId, id, row.x, row.y));
    }
}
