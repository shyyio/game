import {SqlStatement} from "@/common/core.js";
import {installProducer, PRODUCER_STATE_TAIL} from "@/common/EasyProducer.js";

/**
 * The base-case machine behavior: implement one `verb` over the shared Recipes table. Each input port
 * gathers one item — consumed immediately via a sink (a mod never writes Port directly) and recorded in
 * that port's slot. Once every port has contributed, the machine matches the slots in port order against
 * the verb's recipes (falling back to the verb's fallback output when none matches), then produces the
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
     * `stateColumns` (a slot per input port, `processing_remaining`, `processing_output`).
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
        // The consumed batch, kept through processing (cleared on Finish) for the inspect menu.
        const processingInput = port => `processing_input_${port.name}`;

        definition.stateColumns = [
            ...inputPorts.map(port => `${slot(port)} INT`),
            ...inputPorts.map(port => `${processingInput(port)} INT`),
            ...PRODUCER_STATE_TAIL,
        ];

        // The gathered slots in port order (input_N = Nth input port, 0 = unused slot), matching the
        // form stored in Recipes.
        const keys = inputPorts.map(port => `COALESCE(${slot(port)}, 0)`);
        while (keys.length < 3) {
            keys.push("0");
        }

        const allFilled = inputPorts.map(port => `${slot(port)} IS NOT NULL`).join(" AND ");
        const clearSlots = inputPorts.map(port => `${slot(port)} = NULL`).join(", ");
        // Capture the slots into the processing-input record, then clear them (same UPDATE, old-row RHS).
        const captureProcessingInputs = inputPorts.map(port => `${processingInput(port)} = ${slot(port)}`).join(", ");
        const clearProcessingInputs = inputPorts.map(port => `${processingInput(port)} = NULL`).join(", ");

        // Inspect snapshot, per input port (absent ports NULL, padded to 3):
        //   port item (0 = empty) — shown at full opacity, taking precedence;
        //   memory item (gathered slot, else the consumed batch, else 0) — shown at half opacity.
        const portItem = port => `COALESCE((SELECT p.item FROM Port p WHERE p.id = machine.${port.column}), 0)`;
        const memItem = port => `COALESCE(machine.${slot(port)}, machine.${processingInput(port)}, 0)`;
        const inspectPorts = inputPorts.map(port => portItem(port));
        const inspectMemory = inputPorts.map(port => memItem(port));
        while (inspectPorts.length < 3) {
            inspectPorts.push("NULL");
            inspectMemory.push("NULL");
        }

        // Inferred output: while any memory slot holds an item, look the gathered set up in the verb's
        // recipes (fallback when none). NULL when nothing is gathered, so the client falls back to the
        // last produced item.
        const recipeKeys = inputPorts.map(port => memItem(port));
        while (recipeKeys.length < 3) {
            recipeKeys.push("0");
        }
        const anyMemory = inputPorts.map(port => `${memItem(port)} > 0`).join(" OR ");
        const recipeOutput = `CASE WHEN (${anyMemory}) THEN COALESCE(
                        (SELECT r.output_item FROM Recipes r
                         WHERE r.verb = ${verb} AND r.input_1 = ${recipeKeys[0]} AND r.input_2 = ${recipeKeys[1]} AND r.input_3 = ${recipeKeys[2]}),
                        (SELECT f.output_item FROM VerbFallback f WHERE f.verb = ${verb}))
                     ELSE NULL END`;

        const inspectValues = `machine.id,
                    ${inspectPorts[0]}, ${inspectMemory[0]}, ${inspectPorts[1]}, ${inspectMemory[1]}, ${inspectPorts[2]}, ${inspectMemory[2]},
                    machine.processing_remaining, ${processingTicks}, op.item, ${recipeOutput}`;

        // A slot gathers while the machine is idle, or on the tick it produces into a free output port
        // (pipelining: the next batch is consumed in step as the output leaves) — the
        // `(processing_output IS NULL OR (processing_remaining = 0 AND <out port empty>))` condition spelled out in
        // the Sink (via the joined `op`) and the Fill (via a self-contained subquery) below.
        const outItem = `(SELECT po.item FROM Port po WHERE po.id = ${outPort})`;

        installProducer(definition, {
            resolveStatements: [
                ...inputPorts.flatMap(port => [
                    new SqlStatement(
                        // Sink the resting input into an empty slot while gathering (idle, or producing in step).
                        `${table}Sink_${port.name}`,
                        `INSERT INTO PortTransferIntent (source_id, destination_id, managed)
                         SELECT machine.${port.column}, NULL AS destination_id, 1 AS managed
                         FROM ${table} machine
                            INNER JOIN Port inp ON inp.id = machine.${port.column}
                            INNER JOIN Port op ON op.id = machine.${outPort}
                         WHERE machine.${slot(port)} IS NULL AND inp.item IS NOT NULL
                           AND (processing_output IS NULL OR (processing_remaining = 0 AND op.item IS NULL));`
                    ),
                    new SqlStatement(
                        // Record the sunk item in the slot — only when the port holds one, mirroring the Sink's guard.
                        `${table}Fill_${port.name}`,
                        `UPDATE ${table} SET ${slot(port)} = (SELECT inp.item FROM Port inp WHERE inp.id = ${port.column})
                         WHERE ${slot(port)} IS NULL
                           AND (SELECT inp.item FROM Port inp WHERE inp.id = ${port.column}) IS NOT NULL
                           AND (processing_output IS NULL OR (processing_remaining = 0 AND ${outItem} IS NULL));`
                    ),
                ]),
                new SqlStatement(
                    // Every port contributed: match the slots against the verb's recipes (fallback when none),
                    // start the processing countdown, and clear the slots for the next batch.
                    `${table}Resolve`,
                    `UPDATE ${table} SET
                        processing_output = COALESCE(
                            (SELECT r.output_item FROM Recipes r
                             WHERE r.verb = ${verb} AND r.input_1 = ${keys[0]} AND r.input_2 = ${keys[1]} AND r.input_3 = ${keys[2]}),
                            (SELECT f.output_item FROM VerbFallback f WHERE f.verb = ${verb})
                        ),
                        processing_remaining = ${processingTicks},
                        ${captureProcessingInputs},
                        ${clearSlots}
                     WHERE processing_output IS NULL AND ${allFilled};`
                ),
            ],
            inspectValues,
            finishExtra: clearProcessingInputs,
        });
    }
}
