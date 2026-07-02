import {SqlStatement, TickPhase} from "@/common/core.js";

/**
 * The base-case machine behavior: implement one `verb` over the shared Recipes table. Each input port
 * gathers one item — consumed immediately via a sink (a mod never writes Port directly) and recorded in
 * that port's slot. Once every port has contributed, the machine matches the sorted slot set against the
 * verb's recipes (falling back to the verb's fallback output when none matches), then produces the
 * output `processingTicks` later. Backpressure and belt chaining stay the engine's. Build it, then
 * `install(definition)` to set the definition's `verb`, `tickPhases`, and per-port-slot `stateColumns`.
 */
export class EasyRecipeProcessor {

    /**
     * @param {object} config
     * @param {number} config.verb - the verb this machine implements (indexes the Recipes table)
     * @param {number} config.processingTicks - ticks from a completed input set to the output appearing
     */
    constructor({verb, processingTicks}) {
        this._verb = verb;
        this._processingTicks = processingTicks;
    }

    /**
     * Installs this machine onto a definition: records its verb and sets `tickPhases` + per-port-slot
     * `stateColumns` (a slot per input port, `cooldown`, `processing_output`).
     * @param {ObjectDefinition} definition
     * @returns {void}
     */
    install(definition) {
        definition.verb = this._verb;

        const table = definition.table;
        const verb = this._verb;
        const outPort = definition.outputPorts[0].column;
        const processingTicks = this._processingTicks;
        const inputPorts = definition.inputPorts;
        const slot = port => `slot_${port.name}`;

        definition.stateColumns = [
            ...inputPorts.map(port => `${slot(port)} INT`),
            "cooldown INT",
            "processing_output INT",
        ];

        // The gathered slots as a sorted key (input_1<=input_2<=input_3, 0-padded low) matching the
        // canonical form stored in Recipes. Scalar min/max need >=2 args, so pad to 3.
        const values = inputPorts.map(port => `COALESCE(${slot(port)}, 0)`);
        while (values.length < 3) {
            values.push("0");
        }
        const key1 = `min(${values.join(", ")})`;
        const key3 = `max(${values.join(", ")})`;
        const key2 = `(${values.join(" + ")} - ${key1} - ${key3})`;

        const allFilled = inputPorts.map(port => `${slot(port)} IS NOT NULL`).join(" AND ");
        const clearSlots = inputPorts.map(port => `${slot(port)} = NULL`).join(", ");

        // A slot gathers while the machine is idle, or on the tick it produces into a free output port
        // (pipelining: the next batch is consumed in step as the output leaves) — the
        // `(processing_output IS NULL OR (cooldown = 0 AND <out port empty>))` condition spelled out in
        // the Sink (via the joined `op`) and the Fill (via a self-contained subquery) below.
        const outItem = `(SELECT po.item FROM Port po WHERE po.id = ${outPort})`;

        definition.tickPhases = {
            [TickPhase.SUBMIT_INTENTS]: [
                new SqlStatement(
                    `${table}Countdown`,
                    `UPDATE ${table} SET cooldown = cooldown - 1 WHERE cooldown > 0;`
                ),
                ...inputPorts.flatMap(port => [
                    new SqlStatement(
                        // Sink the resting input into an empty slot while gathering (idle, or producing in step).
                        `${table}Sink_${port.name}`,
                        `INSERT INTO PortTransferIntent (source_id, destination_id, managed)
                         SELECT m.${port.column}, NULL AS destination_id, 1 AS managed
                         FROM ${table} m
                            INNER JOIN Port inp ON inp.id = m.${port.column}
                            INNER JOIN Port op ON op.id = m.${outPort}
                         WHERE m.${slot(port)} IS NULL AND inp.item IS NOT NULL
                           AND (processing_output IS NULL OR (cooldown = 0 AND op.item IS NULL));`
                    ),
                    new SqlStatement(
                        // Record the sunk item in the slot — only when the port holds one, mirroring the Sink's guard.
                        `${table}Fill_${port.name}`,
                        `UPDATE ${table} SET ${slot(port)} = (SELECT inp.item FROM Port inp WHERE inp.id = ${port.column})
                         WHERE ${slot(port)} IS NULL
                           AND (SELECT inp.item FROM Port inp WHERE inp.id = ${port.column}) IS NOT NULL
                           AND (processing_output IS NULL OR (cooldown = 0 AND ${outItem} IS NULL));`
                    ),
                ]),
                new SqlStatement(
                    // Every port contributed: match the set against the verb's recipes (fallback when none),
                    // start the cooldown, and clear the slots for the next batch.
                    `${table}Resolve`,
                    `UPDATE ${table} SET
                        processing_output = COALESCE(
                            (SELECT r.output_item FROM Recipes r
                             WHERE r.verb = ${verb} AND r.input_1 = ${key1} AND r.input_2 = ${key2} AND r.input_3 = ${key3}),
                            (SELECT f.output_item FROM VerbFallback f WHERE f.verb = ${verb})
                        ),
                        cooldown = ${processingTicks},
                        ${clearSlots}
                     WHERE processing_output IS NULL AND ${allFilled};`
                ),
                new SqlStatement(
                    `${table}Create`,
                    `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, output_item, managed)
                     SELECT NULL AS source_id, m.${outPort}, (op.item IS NULL) AS destination_is_empty, m.processing_output AS output_item, 1 AS managed
                     FROM ${table} m
                        INNER JOIN Port op ON op.id = m.${outPort}
                     WHERE m.cooldown = 0;`
                ),
            ],
            [TickPhase.POST_RESOLVE]: [
                new SqlStatement(
                    `${table}Finish`,
                    `UPDATE ${table} SET processing_output = NULL, cooldown = NULL
                     WHERE ${outPort} IN (SELECT destination_id FROM ResolvedPortTransfer);`
                ),
            ],
        };
    }
}
