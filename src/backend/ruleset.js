import {rotate} from "@/util.js";
import {SplitterMod} from "@/backend/Splitter.js";
import {Direction} from "@/backend/constants.js";
import {ObjectDefinition, OpCode, PortDefinition, TickOp, TickPhase} from "@/backend/core.js";

const CoreDefinitions = {
    Belt: new ObjectDefinition(
        [
            new PortDefinition("virtual_left", {x: 0, y: 0, direction: Direction.RIGHT}),
            new PortDefinition("virtual_down", {x: 0, y: 0, direction: Direction.UP}),
            new PortDefinition("virtual_right", {x: 0, y: 0, direction: Direction.LEFT}),
        ],
        [
            new PortDefinition("virtual_up", {x: 0, y: -1, direction: Direction.UP}),
        ],
        null,
        null,
        null,
        {},
        {x: 0, y: 0},
        {
            [TickPhase.INPUT]: [
                new TickOp(OpCode.STMT, "TickBeltPathInsertItem"),
                new TickOp(OpCode.STMT, "TickBeltPathCleanup1"),
                new TickOp(OpCode.STMT, "TickBeltPathCleanup2"),
                new TickOp(OpCode.STMT, "TickBeltPathCleanup3"),
                new TickOp(OpCode.STMT, "TickBeltPathCleanup4"),

                new TickOp(OpCode.STMT, "TickBeltPathCleanup5"),
                new TickOp(OpCode.STMT, "TickBeltPathCleanup6"),
            ],
            [TickPhase.OUTPUT]: [
                new TickOp(OpCode.STMT, "TickBeltPathCase1"),
                new TickOp(OpCode.STMT, "TickBeltPathCase2"),

                new TickOp(OpCode.STMT, "TickBeltPathRecalculateHeadGap"),
                new TickOp(OpCode.STMT, "TickBeltFillOutPort"),

            ]

            /*
            *
        this._execStatement(Stmt.TickBeltPathCase1);
        this._execStatement(Stmt.TickBeltPathCase2);

        this._execStatement(Stmt.TickBeltPathRecalculateHeadGap);
        this._execStatement(Stmt.TickBeltFillOutPort);

        this._execStatement(Stmt.TickBeltPathInsertItem);

        this._execStatement(Stmt.TickBeltPathCleanup1);
        this._execStatement(Stmt.TickBeltPathCleanup2);
        this._execStatement(Stmt.TickBeltPathCleanup3);
        this._execStatement(Stmt.TickBeltPathCleanup4);
        this._execStatement(Stmt.TickBeltPathCleanup5);
        this._execStatement(Stmt.TickBeltPathCleanup6);

            * */
        },
    ),
};

class RuleSet {
    constructor() {
        /**
         * @type {Object.<GameObject, ObjectDefinition>}
         */
        this.definitions = CoreDefinitions;
        this.initSchema = [];
        this.tempSchema = [];
    }

    /**
     * @param mod {Mod}
     */
    loadMod(mod) {
        Object.assign(this.definitions, mod.definitions);
        this.initSchema.push(mod.schema);
        this.tempSchema.push(mod.tempSchema);
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

RS.loadMod(new SplitterMod());
