import {SqlStatement, TickPhase} from "@/common/core.js";

/**
 * The base-case machine behavior: consume `inputCount` items from a (single) input port, count them in
 * `inventory`, and `processingTicks` after the recipe completes create one `output` item in the
 * (single) output port. All via transfer intents (a mod never writes Port directly): inputs are sunk
 * (the engine consumes them) and the output is a source-less create the engine resolves, so backpressure
 * and belt chaining are the engine's. To keep the line flowing, the next input is sunk the same tick the
 * output is created. Build the recipe, then `install(definition)` to set that definition's `tickPhases`
 * + `stateColumns` (derived from its table + single in/out port columns).
 */
export class EasyRecipe {

    /**
     * @param {object} config
     * @param {number} config.inputCount - inputs consumed per output
     * @param {number} config.output - the item type produced
     * @param {number} config.processingTicks - ticks from a full recipe to the output appearing
     */
    constructor({inputCount, output, processingTicks}) {
        this._inputCount = inputCount;
        this._output = output;
        this._processingTicks = processingTicks;
    }

    /**
     * Installs this recipe onto a definition: derives its table + single in/out port columns and sets
     * the definition's `tickPhases` + `stateColumns`.
     * @param {ObjectDefinition} definition
     * @returns {void}
     */
    install(definition) {
        const table = definition.table;
        const inPort = definition.inputPorts[0].column;
        const outPort = definition.outputPorts[0].column;
        const inputCount = this._inputCount;
        const output = this._output;
        const processingTicks = this._processingTicks;

        definition.stateColumns = [
            "inventory INT NOT NULL DEFAULT 0",
            "cooldown INT",
        ];

        definition.tickPhases = {
            [TickPhase.SUBMIT_INTENTS]: [
                new SqlStatement(
                    `${table}Countdown`,
                    `UPDATE ${table} SET cooldown = cooldown - 1 WHERE cooldown > 0;`
                ),
                new SqlStatement(
                    // Accumulate inputs; also sink the next one on the production tick so the belt shifts as the output appears.
                    `${table}Sink`,
                    `INSERT INTO PortTransferIntent (source_id, destination_id, managed)
                     SELECT m.${inPort}, NULL AS destination_id, 1 AS managed
                     FROM ${table} m
                        INNER JOIN Port inp ON inp.id = m.${inPort}
                        INNER JOIN Port op ON op.id = m.${outPort}
                     WHERE inp.item IS NOT NULL
                       AND (m.inventory < ${inputCount} OR (m.cooldown = 0 AND op.item IS NULL));`
                ),
                new SqlStatement(
                    `${table}Create`,
                    `INSERT INTO PortTransferIntent (source_id, destination_id, destination_is_empty, output_item, managed)
                     SELECT NULL AS source_id, m.${outPort}, (op.item IS NULL) AS destination_is_empty, ${output} AS output_item, 1 AS managed
                     FROM ${table} m
                        INNER JOIN Port op ON op.id = m.${outPort}
                     WHERE m.cooldown = 0;`
                ),
            ],
            [TickPhase.POST_RESOLVE]: [
                new SqlStatement(
                    `${table}CountInput`,
                    `UPDATE ${table} SET inventory = inventory + 1
                     WHERE ${inPort} IN (SELECT source_id FROM ResolvedSink);`
                ),
                new SqlStatement(
                    `${table}StartCooldown`,
                    `UPDATE ${table} SET cooldown = ${processingTicks}
                     WHERE inventory = ${inputCount} AND cooldown IS NULL;`
                ),
                new SqlStatement(
                    // Decrement (not zero) so a next-batch input sunk on the production tick carries over.
                    `${table}Reset`,
                    `UPDATE ${table} SET inventory = inventory - ${inputCount}, cooldown = NULL
                     WHERE ${outPort} IN (SELECT destination_id FROM ResolvedPortTransfer);`
                ),
            ],
        };
    }
}
