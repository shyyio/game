import {test} from "node:test";
import assert from "node:assert/strict";
import {setupGame} from "@/sdk/test.js";
import {Direction} from "@/common/constants.js";
import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {
    ResourcesMod,
    WaterResourceDefinition,
    VolcanoResourceDefinition,
    ExtractorDefinition,
    DeepExtractorDefinition,
    RESOURCE_WATER,
    RESOURCE_VOLCANO,
    WATER_ITEM_TYPE,
    SULFUR_ITEM_TYPE,
    BRINE_ITEM_TYPE,
} from "@/mods/Resources/Resources.js";

async function setup() {
    return setupGame([new ResourcesMod()]);
}

function place(game, definition, x, y, direction=Direction.UP) {
    game.dispatchMessage(new CreateObjectMessage(definition.typeId, x, y, direction));
}

function extractor(game, table) {
    const id = game.rawScalar(`SELECT id FROM ${table} LIMIT 1`);
    return {
        id,
        resource_type: game.rawScalar(`SELECT resource_type FROM ${table} WHERE id=${id}`),
        out_id: game.rawScalar(`SELECT out_id FROM ${table} WHERE id=${id}`),
    };
}

function outItem(game, outId) {
    return game.rawScalar(`SELECT item FROM Port WHERE id=${outId}`);
}

test("Places a resource and syncs/removes it", async () => {
    const game = await setup();

    place(game, WaterResourceDefinition, 5, 5);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM WaterResource"), 1);

    const id = game.rawScalar("SELECT id FROM WaterResource LIMIT 1");
    game.dispatchMessage(new DeleteObjectMessage(id));
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM WaterResource"), 0);
});

test("Binds an extractor to the resource under it at placement", async () => {
    const game = await setup();

    place(game, WaterResourceDefinition, 5, 5);
    place(game, ExtractorDefinition, 5, 5);

    assert.equal(extractor(game, "Extractor").resource_type, RESOURCE_WATER);
});

test("Rejects an extractor placed off any resource", async () => {
    const game = await setup();

    place(game, ExtractorDefinition, 5, 5);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Extractor"), 0);
});

test("Unbinds and stops producing when its resource is removed", async () => {
    const game = await setup();

    place(game, WaterResourceDefinition, 5, 5);
    place(game, ExtractorDefinition, 5, 5);
    const e = extractor(game, "Extractor");

    const resourceId = game.rawScalar("SELECT id FROM WaterResource LIMIT 1");
    game.dispatchMessage(new DeleteObjectMessage(resourceId));
    assert.equal(extractor(game, "Extractor").resource_type, null);

    // Drain any resting output, then confirm nothing new is produced.
    game.rawExec(`UPDATE Port SET item=NULL WHERE id=${e.out_id}`);
    for (let i = 0; i < 6; i += 1) {
        game.tickAll();
    }
    assert.equal(outItem(game, e.out_id), null);
});

test("Produces nothing when the resource has no recipe for the verb", async () => {
    const game = await setup();

    // Water has only a primary recipe; a deep extractor on it hits no recipe and no fallback.
    place(game, WaterResourceDefinition, 5, 5);
    place(game, DeepExtractorDefinition, 5, 5);
    const e = extractor(game, "DeepExtractor");

    for (let i = 0; i < 10; i += 1) {
        game.tickAll();
    }
    assert.equal(outItem(game, e.out_id), null);
});

test("Produces the resource's item on a countdown", async () => {
    const game = await setup();

    place(game, WaterResourceDefinition, 5, 5);
    place(game, ExtractorDefinition, 5, 5);
    const e = extractor(game, "Extractor");

    for (let i = 0; i < 6; i += 1) {
        game.tickAll();
    }
    assert.equal(outItem(game, e.out_id), WATER_ITEM_TYPE);
});

test("Primary vs secondary extraction yield different items for one resource", async () => {
    const game = await setup();

    // Volcano body at (5,5)..(6,6); extractors sit on the explicit ring tile (5,4).
    place(game, VolcanoResourceDefinition, 5, 5);
    place(game, ExtractorDefinition, 5, 4);
    assert.equal(extractor(game, "Extractor").resource_type, RESOURCE_VOLCANO);

    for (let i = 0; i < 6; i += 1) {
        game.tickAll();
    }
    assert.equal(outItem(game, extractor(game, "Extractor").out_id), SULFUR_ITEM_TYPE);

    place(game, DeepExtractorDefinition, 4, 5);
    assert.equal(extractor(game, "DeepExtractor").resource_type, RESOURCE_VOLCANO);
    for (let i = 0; i < 10; i += 1) {
        game.tickAll();
    }
    assert.equal(outItem(game, extractor(game, "DeepExtractor").out_id), BRINE_ITEM_TYPE);
});

test("A solid resource blocks the surface (extractor rejected on its body)", async () => {
    const game = await setup();

    place(game, VolcanoResourceDefinition, 5, 5);
    place(game, ExtractorDefinition, 5, 5);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Extractor"), 0);
});

test("A non-blocking resource lets an extractor sit on its tile", async () => {
    const game = await setup();

    place(game, WaterResourceDefinition, 5, 5);
    place(game, ExtractorDefinition, 5, 5);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Extractor"), 1);
});

test("Rejects a resource placed in another resource's extraction zone", async () => {
    const game = await setup();

    // Volcano body at (5,5)..(6,6); (5,4) is one of its extraction-ring tiles.
    place(game, VolcanoResourceDefinition, 5, 5);
    place(game, WaterResourceDefinition, 5, 4);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM WaterResource"), 0);

    // Symmetric: a volcano whose ring would cover existing water is rejected too.
    const game2 = await setup();
    place(game2, WaterResourceDefinition, 5, 4);
    place(game2, VolcanoResourceDefinition, 5, 5);
    assert.equal(game2.rawScalar("SELECT COUNT(*) FROM VolcanoResource"), 0);
});
