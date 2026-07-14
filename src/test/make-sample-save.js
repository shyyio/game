import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {DemoMachineDefinition} from "@/mods/DemoMod/DemoMod.js";
import {WaterResourceDefinition, ExtractorDefinition} from "@/mods/Resources/Resources.js";
import {SplitterDefinition} from "@/mods/Logistics/definitions.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine} from "@/test/ecsSim.js";

// Writes a NodeSaveStore SQLite save populated with one of every object type, for inspecting the
// on-disk save format. Output path is argv[2] (default SAMPLE.sqlite3).
const PATH = process.argv[2] === undefined ? "SAMPLE.sqlite3" : process.argv[2];

const engine = await makeGameEngine();
engine.applyMessage(new CreateObjectMessage(WaterResourceDefinition.typeId, 5, 5, Direction.UP));
engine.applyMessage(new CreateObjectMessage(ExtractorDefinition.typeId, 5, 5, Direction.UP));
engine.applyMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, 10, 10, Direction.UP));
engine.splitter.placeSplitter(3, 8, true);
[{x: 20, y: 20}, {x: 20, y: 21}, {x: 20, y: 22}, {x: 20, y: 23}].forEach(cell =>
    engine.applyMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL)));
for (let i = 0; i < 5; i += 1) {
    engine.tickAll();
}

const store = new NodeSaveStore(PATH);
await store.save(engine.serialize());
console.log(`wrote sample save: ${PATH}`);
