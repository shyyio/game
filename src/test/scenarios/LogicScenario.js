// A logic-network testbed: a terminal wired straight to its devices (no poles), so the rule
// editor is one tap away — two gates to toggle, a Blender to enable/disable, and a pre-filled
// water tank for the stored conditions.

import {Direction, CHUNK_SIZE} from "@/sdk/common.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {chunkOrdinal} from "@/common/util.js";
import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {GateDefinition, LogicTerminalDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {WireLinkMessage} from "@/mods/Logistics/common/messages.js";
import {TankDefinition} from "@/mods/Fluids/common/objectTypes.js";
import {BlenderType} from "@/mods/BaseGame/common/objectTypes.js";
import {ITEM_TYPE_WATER} from "@/mods/BaseGame/common/constants.js";

// The player the testbed is claimed for: the local session's own id, so the panel and wire tool
// work without claiming anything by hand.
const LOGIC_PLAYER_ID = 1;

const TERMINAL_X = 12;
const TERMINAL_Y = 8;
const TANK_WATER_AMOUNT = 30;

/**
 * Places one object and returns its objectId (the newest placed row's).
 * @param {GameEngine} engine
 * @param {ObjectType} type
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function place(engine, type, x, y) {
    if (!engine.applyMessage(new CreateObjectMessage(type.typeId, x, y, Direction.UP))) {
        throw new Error(`Logic scenario failed to place ${type.name} at (${x}, ${y})`);
    }
    const def = engine.placed.def;
    return def.store.objectId[def.row(def.eids[def.count - 1])];
}

/**
 * A terminal with a gate wired to it directly, plus enough devices to exercise every condition
 * type in the rule editor.
 */
export class LogicScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "logic";
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        const engine = game.simEngine;
        game.claims.claim(
            LOGIC_PLAYER_ID,
            chunkOrdinal(Math.floor(TERMINAL_X / CHUNK_SIZE), Math.floor(TERMINAL_Y / CHUNK_SIZE)),
            1,
        );

        const terminal = place(engine, LogicTerminalDefinition, TERMINAL_X, TERMINAL_Y);
        const gateA = place(engine, GateDefinition, TERMINAL_X - 2, TERMINAL_Y);
        const gateB = place(engine, GateDefinition, TERMINAL_X + 2, TERMINAL_Y);
        const blender = place(engine, BlenderType, TERMINAL_X - 3, TERMINAL_Y + 3);
        const tank = place(engine, TankDefinition, TERMINAL_X + 2, TERMINAL_Y + 3);

        const tankDef = engine.component("Tank");
        const tankRow = tankDef.row(engine.placed.eidByObjectId(tank));
        tankDef.store.fluidType[tankRow] = ITEM_TYPE_WATER;
        tankDef.store.amount[tankRow] = TANK_WATER_AMOUNT;

        const session = new CapturingSession(LOGIC_PLAYER_ID);
        for (const deviceId of [gateA, gateB, blender, tank]) {
            game.dispatchMessage(new WireLinkMessage(terminal, deviceId), session);
        }
    }
}
