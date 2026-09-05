import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BeltDefinition, SplitterDefinition} from "@/mods/logistics/common/objectTypes.js";
import {WaterResourceType, ExtractorType, BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {PipeDefinition, TankDefinition} from "@/mods/fluids/common/objectTypes.js";
import {FLUID_TYPE_WATER} from "@/mods/fluids/common/constants.js";
import {Pipes} from "@/mods/fluids/sim/Pipes.js";

// Writes a NodeSaveStore SQLite save populated with one of every object type, plus players, a
// friendship, and a chunk claim, for inspecting the on-disk save format. Output path is argv[2]
// (default SAMPLE.sqlite3).
const PATH = process.argv[2] === undefined ? "SAMPLE.sqlite3" : process.argv[2];

const modRegistry = ecsModRegistry();
const engine = new GameEngine(modRegistry);
const game = new Game(modRegistry, engine, new NodeSaveStore(PATH));
await game.init();
engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, 5, 5, Direction.UP));
engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 5, 5, Direction.UP));
engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 10, 10, Direction.UP));
engine.applyMessage(new CreateObjectMessage(SplitterDefinition.typeId, 3, 8, Direction.UP));
for (const cell of [{x: 20, y: 20}, {x: 20, y: 21}, {x: 20, y: 22}, {x: 20, y: 23}]) {
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, cell.x, cell.y, Direction.UP));
}
// A pipe run feeding a tank at (30, 30), 2x2 covering (30..31, 30..31).
engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 30, 32, Direction.UP));
engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 30, 33, Direction.UP));
engine.applyMessage(new CreateObjectMessage(TankDefinition.typeId, 30, 30, Direction.UP));
engine.resolve(Pipes).addFluid(30, 32, FLUID_TYPE_WATER, 50);
for (let i = 0; i < 5; i += 1) {
    engine.tickAll();
}

// Two players, a one-way friendship, and a claim on the extractor's chunk.
const alice = game.players.getOrCreate("sub-alice", "alice");
const bob = game.players.getOrCreate("sub-bob", "bob");
game.players.addFriend(alice.playerId, bob.playerId);
game.claims.claim(alice.playerId, chunkId(5, 5), alice.maxChunks);

await game.save();
console.log(`wrote sample save: ${PATH}`);
