import {test} from "node:test";
import assert from "node:assert/strict";
import {MachineBehavior} from "@/sim/behaviors/MachineBehavior.js";
import {ExtractorBehavior} from "@/sim/behaviors/ExtractorBehavior.js";
import {GeneratorBehavior} from "@/sim/behaviors/GeneratorBehavior.js";
import {GateBehavior} from "@/mods/logistics/sim/GateBehavior.js";
import {TankBehavior} from "@/mods/fluids/sim/TankBehavior.js";
import {TradingTerminalBehavior} from "@/mods/market/sim/TradingTerminalBehavior.js";

const ITEM_TYPE_ID = 7;

test("every producer marks the synced field holding its last product", () => {
    const producers = [
        new MachineBehavior({processingTicks: 1, recipes: [], fallback: ITEM_TYPE_ID}),
        new ExtractorBehavior({processingTicks: 1, recipes: []}),
        new GeneratorBehavior({processingTicks: 1, output: ITEM_TYPE_ID}),
        new GateBehavior(),
        new TradingTerminalBehavior(),
    ];
    for (const behavior of producers) {
        assert.equal(behavior.syncedFields.productField.name, "lastOutput", behavior.constructor.name);
    }
});

test("a tank's product is the fluid it holds", () => {
    assert.equal(new TankBehavior({capacity: 10}).syncedFields.productField.name, "fluidType");
});
