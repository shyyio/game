import {test} from "node:test";
import assert from "node:assert/strict";
import {setupGame} from "@/sdk/test.js";
import {AbstractMod, ObjectDefinition, PortDefinition, RecipeDefinition} from "@/common/core.js";
import {EasyRecipeProcessor} from "@/common/EasyRecipeProcessor.js";
import {EasyObjectPlacement} from "@/common/EasyObjectPlacement.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {Direction} from "@/common/constants.js";

// Item types and verbs used across these specs.
const RED = 1;
const GREEN = 2;
const YELLOW = 3;
const BLUE = 4;
const COAL = 5;
const ALLOY = 10;
const GLASS = 11;
const COKE = 12;
const MIX_JUNK = 98;
const COOK_SLAG = 99;
const INVERSE_ALLOY = 13;

// A 2-input Mixer implementing MIX (red+green->alloy, green+red->inverse alloy, yellow+blue->glass,
// else junk), and a Furnace +
// Oven that both implement COOK (coal->coke, else slag) at different cooldowns to share one table.
function mixer(processingTicks=1) {
    const definition = new ObjectDefinition({
        table: "Mixer",
        inputPorts: [
            new PortDefinition("a", {x: 0, y: 0, direction: Direction.UP}),
            new PortDefinition("b", {x: 0, y: 0, direction: Direction.RIGHT}),
        ],
        outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
        internalPorts: [],
        geometry: "1x1",
    });
    new EasyRecipeProcessor({verb: 1, processingTicks}).install(definition);
    return definition;
}

function furnace(table, processingTicks) {
    const definition = new ObjectDefinition({
        table,
        inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
        outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
        internalPorts: [],
        geometry: "1x1",
    });
    new EasyRecipeProcessor({verb: 2, processingTicks}).install(definition);
    return definition;
}

// A sim-side mod exposing the given machine definitions via the generic placement helper, plus the
// recipe + fallback rows for the verbs they implement.
class MachineMod extends AbstractMod {

    constructor(definitions, recipes, fallbacks) {
        super();
        this._definitions = definitions;
        this._recipes = recipes;
        this._fallbacks = fallbacks;
        this._placements = definitions.map(definition => new EasyObjectPlacement(definition));
    }

    get schema() {
        return this._placements.map(placement => placement.schema).join("\n");
    }

    get definitions() {
        return Object.fromEntries(this._definitions.map(definition => [definition.table, definition]));
    }

    get recipes() {
        return this._recipes;
    }

    get verbFallbacks() {
        return this._fallbacks;
    }

    get extraStatements() {
        return this._placements.flatMap(placement => placement.statements);
    }

    chunkSyncEvents(chunk) {
        return this._placements.flatMap(placement => placement.chunkSyncEvents(this.game, chunk));
    }

    onMessage(message) {
        this._placements.forEach(placement => placement.handleMessage(this.game, message));
    }
}

const MIX_RECIPES = [
    new RecipeDefinition(1, [RED, GREEN], ALLOY),
    new RecipeDefinition(1, [GREEN, RED], INVERSE_ALLOY),
    new RecipeDefinition(1, [YELLOW, BLUE], GLASS),
];
const MIX_FALLBACK = [{verb: 1, output: MIX_JUNK}];
const COOK_RECIPES = [new RecipeDefinition(2, [COAL], COKE)];
const COOK_FALLBACK = [{verb: 2, output: COOK_SLAG}];

function createObject(game, definition, x, y) {
    game.dispatchMessage(new CreateObjectMessage(definition.typeId, x, y, Direction.UP));
}

function ports(game, table, columns) {
    const id = game.rawScalar(`SELECT id FROM ${table} LIMIT 1`);
    const result = {id};
    columns.forEach(column => {
        result[column] = game.rawScalar(`SELECT ${column} FROM ${table} WHERE id=${id}`);
    });
    return result;
}

function inject(game, portId, type) {
    game.rawExec(`UPDATE Port SET item=${type} WHERE id=${portId}`);
}

function item(game, portId) {
    return game.rawScalar(`SELECT item FROM Port WHERE id=${portId}`);
}

test("Mixes two inputs into the recipe output", async () => {
    const definition = mixer();
    const game = await setupGame([new MachineMod([definition], MIX_RECIPES, MIX_FALLBACK)]);
    createObject(game, definition, 5, 5);
    const p = ports(game, "Mixer", ["a_id", "b_id", "out_id"]);

    inject(game, p.a_id, RED);
    inject(game, p.b_id, GREEN);
    game.tickAll();
    // Both inputs consumed the tick they land; the output follows one processing tick later.
    assert.equal(item(game, p.a_id), null);
    assert.equal(item(game, p.b_id), null);
    game.tickAll();
    assert.equal(item(game, p.out_id), ALLOY);
});

test("Matches inputs by port order", async () => {
    const definition = mixer();
    const game = await setupGame([new MachineMod([definition], MIX_RECIPES, MIX_FALLBACK)]);
    createObject(game, definition, 5, 5);
    const p = ports(game, "Mixer", ["a_id", "b_id", "out_id"]);

    // Same items, swapped ports: green on a, red on b matches green+red, not red+green.
    inject(game, p.a_id, GREEN);
    inject(game, p.b_id, RED);
    game.tickAll();
    game.tickAll();
    assert.equal(item(game, p.out_id), INVERSE_ALLOY);
});

test("Produces the verb fallback for an input combination with no recipe", async () => {
    const definition = mixer();
    const game = await setupGame([new MachineMod([definition], MIX_RECIPES, MIX_FALLBACK)]);
    createObject(game, definition, 5, 5);
    const p = ports(game, "Mixer", ["a_id", "b_id", "out_id"]);

    // red + blue is not a recipe -> Junk.
    inject(game, p.a_id, RED);
    inject(game, p.b_id, BLUE);
    game.tickAll();
    game.tickAll();
    assert.equal(item(game, p.out_id), MIX_JUNK);
});

test("Gathers inputs arriving on different ticks", async () => {
    const definition = mixer();
    const game = await setupGame([new MachineMod([definition], MIX_RECIPES, MIX_FALLBACK)]);
    createObject(game, definition, 5, 5);
    const p = ports(game, "Mixer", ["a_id", "b_id", "out_id"]);

    // Only port a filled: its input is consumed immediately, but nothing resolves yet.
    inject(game, p.a_id, RED);
    game.tickAll();
    assert.equal(item(game, p.a_id), null);
    assert.equal(item(game, p.out_id), null);

    // Port b arrives later, completing the set.
    inject(game, p.b_id, GREEN);
    game.tickAll();
    game.tickAll();
    assert.equal(item(game, p.out_id), ALLOY);
});

test("Consumes the next batch on every port the tick it produces (pipelining)", async () => {
    const definition = mixer();
    const game = await setupGame([new MachineMod([definition], MIX_RECIPES, MIX_FALLBACK)]);
    createObject(game, definition, 5, 5);
    const p = ports(game, "Mixer", ["a_id", "b_id", "out_id"]);

    // Keep both ports fed and drain the output each tick; the tick an output appears both inputs are
    // consumed in step for the next batch.
    let producedOnce = false;
    let consumedBothOnProduction = false;
    for (let i = 0; i < 12; i += 1) {
        inject(game, p.a_id, RED);
        inject(game, p.b_id, GREEN);
        game.rawExec(`UPDATE Port SET item=NULL WHERE id=${p.out_id}`);
        game.tickAll();
        if (item(game, p.out_id) === ALLOY) {
            producedOnce = true;
            if (item(game, p.a_id) === null && item(game, p.b_id) === null) {
                consumedBothOnProduction = true;
            }
        }
    }
    assert.ok(producedOnce);
    assert.ok(consumedBothOnProduction);
});

test("Two machine types share one verb's recipes at different cooldowns", async () => {
    const oven = furnace("Oven", 1);
    const slowFurnace = furnace("Furnace", 3);
    const game = await setupGame([new MachineMod([oven, slowFurnace], COOK_RECIPES, COOK_FALLBACK)]);
    createObject(game, oven, 5, 5);
    createObject(game, slowFurnace, 8, 8);
    const ovenPorts = ports(game, "Oven", ["in_id", "out_id"]);
    const furnacePorts = ports(game, "Furnace", ["in_id", "out_id"]);

    inject(game, ovenPorts.in_id, COAL);
    inject(game, furnacePorts.in_id, COAL);

    // Both cook coal into coke off the same table; the oven (cooldown 1) finishes before the furnace (3).
    game.tickAll();
    game.tickAll();
    assert.equal(item(game, ovenPorts.out_id), COKE);
    assert.equal(item(game, furnacePorts.out_id), null);
    game.tickAll();
    game.tickAll();
    assert.equal(item(game, furnacePorts.out_id), COKE);
});
