import {SqlStatement} from "@/common/core.js";
import {installProducer, PRODUCER_STATE_TAIL} from "@/common/EasyProducer.js";

/**
 * A resource extractor: a producer machine whose single input is not gathered from a port but is the
 * fixed `resource_type` of the resource under its footprint (bound at placement via ResourceCoverAt).
 * It looks that resource up in the verb's Recipes (fallback when none) and produces the output every
 * `processingTicks`, delivering it into its one output port via the transfer resolver -- the same
 * produce path as EasyRecipeProcessor. Build it, then `install(definition)`.
 */
export class EasyExtractor {

    /**
     * @param {object} config
     * @param {number} config.verb - the extraction verb (indexes the Recipes table)
     * @param {number} config.processingTicks - ticks between produced outputs
     * @param {string} [config.coverStatement] - the mod's ResourceCoverAt statement, probed at placement
     */
    constructor({verb, processingTicks, coverStatement="ResourceCoverAt"}) {
        this._verb = verb;
        this._processingTicks = processingTicks;
        this._coverStatement = coverStatement;
        this._definition = null;
    }

    /**
     * The placement statement setting a placed extractor's bound resource. A mod merges it into its
     * `statements`.
     * @returns {SqlStatement[]}
     */
    get statements() {
        return [
            new SqlStatement(
                `Set${this._definition.table}Resource`,
                `UPDATE ${this._definition.table} SET resource_type = @resource_type WHERE id = CAST(@id AS INT);`
            ),
        ];
    }

    /**
     * Installs this extractor onto a definition: records its verb; sets `stateColumns`
     * (resource_type + processing), `tickPhases`, `inspectOneStatement`, and the `afterCreate` hook
     * binding the resource under the extractor's footprint.
     * @param {ObjectDefinition} definition
     * @returns {void}
     */
    install(definition) {
        this._definition = definition;
        definition.verb = this._verb;

        const table = definition.table;
        const verb = this._verb;
        const processingTicks = this._processingTicks;
        const coverStatement = this._coverStatement;

        definition.stateColumns = [
            "resource_type INT",
            ...PRODUCER_STATE_TAIL,
        ];

        // The bound resource (referenced as `resourceRef`) looked up in the verb's recipes (single input;
        // fallback when none). Parameterized because UPDATE has no table alias but the inspect SELECT does.
        const recipeOutput = resourceRef => `COALESCE(
                    (SELECT r.output_item FROM Recipes r
                     WHERE r.verb = ${verb} AND r.input_1 = ${resourceRef} AND r.input_2 = 0 AND r.input_3 = 0),
                    (SELECT f.output_item FROM VerbFallback f WHERE f.verb = ${verb}))`;

        // Inspect snapshot: the bound resource shown as the (memory) input, the produced item, and the
        // resource's would-be output. No input ports, so the port columns stay empty.
        const inspectValues = `machine.id,
                    0, COALESCE(machine.resource_type, 0), NULL, NULL, NULL, NULL,
                    machine.processing_remaining, ${processingTicks}, op.item,
                    CASE WHEN machine.resource_type IS NOT NULL THEN ${recipeOutput("machine.resource_type")} ELSE NULL END`;

        installProducer(definition, {
            resolveStatements: [
                new SqlStatement(
                    // Idle + bound to a resource that yields an output: start the countdown toward it.
                    `${table}Resolve`,
                    `UPDATE ${table} SET
                        processing_output = ${recipeOutput("resource_type")},
                        processing_remaining = ${processingTicks}
                     WHERE processing_output IS NULL
                       AND resource_type IS NOT NULL
                       AND ${recipeOutput("resource_type")} IS NOT NULL;`
                ),
            ],
            inspectValues,
        });

        // The resource types covering the extractor's footprint (a null per uncovered cell).
        const footprintCovers = (game, x, y, direction) =>
            definition.geometry.tiles(direction).map(cell =>
                game.queryScalar(coverStatement, {x: x + cell.x, y: y + cell.y})
            );

        // Placement requires a resource under the footprint.
        definition.canPlace = (game, options) =>
            footprintCovers(game, options.x, options.y, options.direction).some(cover => cover !== null);

        // At placement, bind the resource under the extractor's footprint (first cover hit wins).
        definition.afterCreate = (game, id, options) => {
            const resourceType = footprintCovers(game, options.x, options.y, options.direction).find(cover => cover !== null);
            if (resourceType !== undefined) {
                game.exec(`Set${table}Resource`, {id, resource_type: resourceType});
            }
        };
    }
}
