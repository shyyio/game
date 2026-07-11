import {SimEngine} from "@/common/sim/SimEngine.js";
import {EcsEngine} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/common/sim/BeltSystems.js";
import {SplitterModule} from "@/common/sim/SplitterSystems.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";

/**
 * The bitECS {@link SimEngine}: owns the world and the content modules, dispatches player messages to
 * them, and runs the tick systems. The seam Game will drive instead of {@link SqlSimEngine} once the
 * message/chunk-sync surface is complete. Belt-normal placement only so far.
 *
 * Module construction order matters: the splitter's POST_RESOLVE seam must read a shared port before
 * the belt writes this tick's pop into it, so SplitterModule is built before BeltModule.
 */
export class EcsSimEngine extends SimEngine {

    constructor() {
        super();
        this.engine = new EcsEngine();

        /**
         * @type {SplitterModule|null}
         */
        this.splitter = null;

        /**
         * @type {BeltModule|null}
         */
        this.belts = null;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        await this.engine.init();
        this.splitter = new SplitterModule(this.engine);
        this.belts = new BeltModule(this.engine);
    }

    /**
     * Routes a player message to the module that owns it.
     * @param {AbstractMessage} message
     * @returns {boolean} whether the engine handled it
     */
    applyMessage(message) {
        if (message instanceof CreateBeltMessage) {
            const type = message.beltType === null || message.beltType === undefined ? BELT_NORMAL : message.beltType;
            if (type === BELT_NORMAL) {
                this.belts.placeBelt(message.x, message.y, message.direction);
                return true;
            }
        }
        return false;
    }

    /**
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        this.engine.tick(phase);
    }

    /**
     * Returns and clears this tick's render events (the owner dispatches them to sessions).
     * @returns {object[]}
     */
    drainRenderEvents() {
        return this.engine.drainRenderEvents();
    }

    /**
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        return this.belts.chunkSync(chunk);
    }
}
