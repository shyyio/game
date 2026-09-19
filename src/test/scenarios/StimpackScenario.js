import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";
import {positiveIntParam} from "@/test/scenarios/scenarioParam.js";
import {buildStimpackFactory} from "@/test/stimpackLine.js";
import {CHUNK_SIZE} from "@/common/constants.js";

const ORIGIN_X = 2;
const ORIGIN_Y = 2;
// One factory per quarter chunk: a factory fits in a 32-tile box, and a quadrant never crosses a
// chunk border, which no object may straddle.
const COPY_PITCH = CHUNK_SIZE / 2;
// Pre-run ticks: fills the belts and gives the production chart a full history window on open.
const WARMUP_TICKS = 0;
const COPY_COUNT_PARAM = "n";
const DEFAULT_COPY_COUNT = 1;

/**
 * The full production chain, physically placed and wired end to end: raw extraction through
 * Biotech/Industry to a working Stimpack assembly line. `n` copies tile a near-square grid, four to
 * a chunk.
 */
export class StimpackScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "stimpack";
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        const copies = positiveIntParam(params.get(COPY_COUNT_PARAM), DEFAULT_COPY_COUNT);
        const columns = Math.ceil(Math.sqrt(copies));
        for (let copy = 0; copy < copies; copy += 1) {
            const originX = ORIGIN_X + (copy % columns) * COPY_PITCH;
            const originY = ORIGIN_Y + Math.floor(copy / columns) * COPY_PITCH;
            buildStimpackFactory(game.simEngine, game, originX, originY);
        }
        for (let tick = 0; tick < WARMUP_TICKS; tick += 1) {
            game.runTick();
        }
    }
}
