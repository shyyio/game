import {Direction} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BeltType, SplitterType} from "@/mods/logistics/common/objectTypes.js";
import {WaterResourceType, ExtractorType, BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {PipeType, TankType} from "@/mods/fluids/common/objectTypes.js";
import {FLUID_TYPE_WATER} from "@/mods/fluids/common/constants.js";
import {PipeNetworkIndex} from "@/mods/fluids/sim/PipeNetworkIndex.js";

// Writes a NodeSaveStore SQLite save populated with one of every object type, plus players, a
// friendship, and a chunk claim, for inspecting the on-disk save format. Output path is argv[2]
// (default SAMPLE.sqlite3).
const PATH = process.argv[2] === undefined ? "SAMPLE.sqlite3" : process.argv[2];

const modRegistry = ecsModRegistry();
const engine = new GameEngine(modRegistry);
const game = new Game(modRegistry, engine, new NodeSaveStore(PATH));
await game.init();
engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 5, 5, Direction.UP));
engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 5, 5, Direction.UP));
engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 10, 10, Direction.UP));
engine.applyMessage(new CreateObjectMessage(SplitterType.objectTypeId, 3, 8, Direction.UP));
for (const cell of [{x: 20, y: 20}, {x: 20, y: 21}, {x: 20, y: 22}, {x: 20, y: 23}]) {
    engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, cell.x, cell.y, Direction.UP));
}
// A pipe run into a tank at (30, 30), 2x2 covering (30..31, 30..31).
engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 30, 32, Direction.UP));
engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 30, 33, Direction.UP));
engine.applyMessage(new CreateObjectMessage(TankType.objectTypeId, 30, 30, Direction.UP));
engine.resolve(PipeNetworkIndex).addFluid(30, 32, FLUID_TYPE_WATER, 50);
for (let i = 0; i < 5; i += 1) {
    engine.tick();
}

// Two players, a one-way friendship, and a claim on the extractor's chunk.
const alice = game.players.getOrCreate("sub-alice", "alice");
const bob = game.players.getOrCreate("sub-bob", "bob");
game.players.addFriend(alice.playerRef, bob.playerRef);
game.claims.claim(alice.playerRef, chunkKeyAt(5, 5), alice.maxChunks);

await game.save();
console.log(`wrote sample save: ${PATH}`);
