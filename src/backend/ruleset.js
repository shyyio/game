import {rotate} from "@/util.js";
import {SplitterMod} from "@/backend/Splitter.js";
import {Direction} from "@/backend/constants.js";
import {ObjectDefinition, OpCode, PortDefinition, TickOp, TickPhase} from "@/backend/core.js";
import {BeltMod} from "@/backend/Belt.js";

const CoreDefinitions = {
};

class RuleSet {
    constructor() {
        /**
         * @type {Object.<GameObject, ObjectDefinition>}
         */
        this.definitions = CoreDefinitions;
        this.initSchema = [];
        this.tempSchema = [];
        this.triggers = [];
    }

    /**
     * @param mod {Mod}
     */
    loadMod(mod) {
        Object.assign(this.definitions, mod.definitions);
        this.initSchema.push(mod.schema);
        this.tempSchema.push(mod.tempSchema);
        this.triggers.push(mod.triggers);
    }

    objectTiles(name, x, y, direction) {
        const width = rotate(this.definitions[name].size, direction).x;
        const height = rotate(this.definitions[name].size, direction).y;

        const tiles = [];
        for (let dx = 0; dx <= Math.abs(width); dx++) {
            for (let dy = 0; dy <= Math.abs(height); dy++) {
                tiles.push({
                    x: x + Math.sign(width) * dx,
                    y: y + Math.sign(height) * dy
                });
            }
        }
        return tiles;
    }
}

/**
 * @type {RuleSet}
 */
export const RS = new RuleSet();

RS.loadMod(new BeltMod());
RS.loadMod(new SplitterMod());
