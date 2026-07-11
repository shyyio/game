import {SqlStatement, TickPhase} from "@/common/core.js";
import {BUFFERED_EVENT_TYPE_EASY_OBJECT_UPDATE} from "@/common/constants.js";
import {CHUNK_COORD_SQL} from "@/common/DatabaseSchema.js";

// State columns every producer carries beyond its input-specific ones.
export const PRODUCER_STATE_TAIL = ["processing_remaining INT", "processing_output INT"];

// Inspect snapshot columns, shared by the heartbeat and on-open statements.
export const PRODUCER_INSPECT_COLUMNS = `(object_id,
                    in_1_port, in_1_mem, in_2_port, in_2_mem, in_3_port, in_3_mem,
                    processing_remaining, processing_total, output_item, recipe_output)`;

/**
 * Installs the shared producer pipeline onto a definition: Countdown + the caller's input-specific
 * resolve statements + Create (SUBMIT_INTENTS), EmitOutput + Finish (POST_RESOLVE), and the inspect
 * snapshot (EMIT_INSPECT + the on-open `inspectOneStatement`). The caller supplies how input is
 * gathered/resolved into `processing_output`/`processing_remaining` and the inspect SELECT values.
 * @param {ObjectDefinition} definition
 * @param {object} config
 * @param {SqlStatement[]} config.resolveStatements - input-specific SUBMIT statements, run between Countdown and Create
 * @param {string} config.inspectValues - inspect SELECT values (matching PRODUCER_INSPECT_COLUMNS)
 * @param {string} [config.finishExtra] - extra SET assignments appended to Finish
 * @returns {void}
 */
export function installProducer(definition, {resolveStatements, inspectValues, finishExtra=""}) {
    const table = definition.table;
    const outPort = definition.outputPorts[0].column;
    const finishSet = finishExtra ? `, ${finishExtra}` : "";

    definition.tickPhases = {
        [TickPhase.SUBMIT_INTENTS]: [
            new SqlStatement(
                `${table}Countdown`,
                `UPDATE ${table} SET processing_remaining = processing_remaining - 1 WHERE processing_remaining > 0;`
            ),
            ...resolveStatements,
            new SqlStatement(
                `${table}Create`,
                `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, output_item, managed)
                 SELECT NULL AS source_id, machine.${outPort}, (op.item IS NULL) AS destination_is_empty, machine.processing_output AS output_item, 1 AS managed
                 FROM ${table} machine
                    INNER JOIN Port op ON op.id = machine.${outPort}
                 WHERE machine.processing_remaining = 0;`
            ),
        ],
        [TickPhase.POST_RESOLVE]: [
            new SqlStatement(
                // A machine that just delivered produced last_output; broadcast it (BufferedEvent,
                // routed by chunk) when it changed. Runs before Finish clears processing_output.
                `${table}EmitOutput`,
                `INSERT INTO BufferedEvent (type, routing_chunk_x, routing_chunk_y, id, a)
                 SELECT ${BUFFERED_EVENT_TYPE_EASY_OBJECT_UPDATE}, ${CHUNK_COORD_SQL("machine.x")}, ${CHUNK_COORD_SQL("machine.y")},
                        machine.id, machine.processing_output
                 FROM ${table} machine
                 WHERE machine.${outPort} IN (SELECT destination_id FROM ResolvedPortTransfer)
                   AND (machine.last_output IS NULL OR machine.last_output != machine.processing_output);`
            ),
            new SqlStatement(
                `${table}Finish`,
                `UPDATE ${table} SET last_output = processing_output, processing_output = NULL, processing_remaining = NULL${finishSet}
                 WHERE ${outPort} IN (SELECT destination_id FROM ResolvedPortTransfer);`
            ),
        ],
        [TickPhase.EMIT_INSPECT]: [
            new SqlStatement(
                // Snapshot every inspected machine (heartbeat), driven by the small SessionInspect
                // (distinct, so a machine two sessions inspect snapshots once) probing machines by PK.
                `${table}Inspect`,
                `WITH inspected AS (SELECT DISTINCT object_id FROM SessionInspect)
                 INSERT INTO BufferedInspectHeartbeatEvent
                    ${PRODUCER_INSPECT_COLUMNS}
                 SELECT ${inspectValues}
                 FROM inspected
                    INNER JOIN ${table} machine ON machine.id = inspected.object_id
                    INNER JOIN Port op ON op.id = machine.${outPort};`
            ),
        ],
    };

    // One machine's snapshot by id (PK lookup), for the on-open sync — no session join.
    definition.inspectOneStatement = new SqlStatement(
        `${table}InspectOne`,
        `INSERT INTO BufferedInspectHeartbeatEvent
            ${PRODUCER_INSPECT_COLUMNS}
         SELECT ${inspectValues}
         FROM ${table} machine
            INNER JOIN Port op ON op.id = machine.${outPort}
         WHERE machine.id = CAST(@object_id AS INT);`
    );
}
