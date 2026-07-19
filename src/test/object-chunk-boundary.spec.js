import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent} from "@/common/ObjectEvents.js";
import {HousingDefinition} from "@/mods/Logistics/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";

// Hard constraint: a placed object never crosses a chunk boundary — chunk-keyed sync and the
// position index assume every object lives in exactly one chunk.
test("a multi-tile object straddling a chunk boundary is rejected", async () => {
    const engine = await makeGameEngine();
    const collector = new EventCollector(engine);

    // A 2x2 anchored on the chunk's last column would span into the next chunk.
    const edge = CHUNK_SIZE - 1;
    assert.equal(engine.applyMessage(new CreateObjectMessage(HousingDefinition.typeId, edge, 5, Direction.UP)), true);
    assert.ok(
        !collector.drain().some(event => event instanceof ObjectInsertEvent),
        "no insert for a chunk-straddling footprint",
    );

    // One tile back it fits inside the chunk.
    assert.equal(engine.applyMessage(new CreateObjectMessage(HousingDefinition.typeId, edge - 1, 5, Direction.UP)), true);
    assert.ok(
        collector.drain().some(event => event instanceof ObjectInsertEvent),
        "the same footprint inside one chunk places",
    );
});
