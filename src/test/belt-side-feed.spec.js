import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/sim/Belts.js";
import {PortDefinition} from "@/sdk/common.js";
import {BELT_TUNNEL_DOWN, BELT_TUNNEL_UP, BELT_UNDERGROUND} from "@/mods/Logistics/common/constants.js";

const RED = 1;
const EMPTY = -1;

// A 1x1 machine's output: one tile ahead, facing the machine.
const OUT_PORT = new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP});

// A belt bending out of a machine takes the feed on its flank edge, not its straight one, so the
// machine's output port and the belt's in-port must still coincide.
test("a belt bending out of a machine's output ingests it", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);

    // Belts at (5,5)+(5,4) flow UP; the machine at (4,5) faces RIGHT, so its output lands on (5,5).
    belts.placeBelt(5, 4, Direction.UP);
    belts.placeBelt(5, 5, Direction.UP);
    const machineOut = engine.portFor(OUT_PORT, 4, 5, Direction.RIGHT).port;
    engine.ports.setItem(machineOut, RED);

    let drained = false;
    for (let i = 0; i < 8 && !drained; i += 1) {
        engine.tickAll();
        drained = engine.ports.item(machineOut) === EMPTY;
    }
    assert.ok(drained, "the machine's output port emptied into the belt");
    const path = belts.paths.find(candidate => candidate.headX === 5 && candidate.headY === 5);
    assert.equal(belts.itemsOf(path).filter(item => item.type === RED).length, 1, "the item rides the belt");
});

// Paths never cross a chunk seam, so a run bending exactly on one becomes two paths whose shared
// edge port faces the upstream segment, not the downstream head.
test("a run bending on a chunk seam carries items across it", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);

    // (CHUNK_SIZE-2,5)+(CHUNK_SIZE-1,5) flow RIGHT into the next chunk, where the run turns UP.
    const seam = CHUNK_SIZE;
    belts.placeBelt(seam - 2, 5, Direction.RIGHT);
    belts.placeBelt(seam - 1, 5, Direction.RIGHT);
    belts.placeBelt(seam, 5, Direction.UP);
    belts.placeBelt(seam, 4, Direction.UP);

    const upstream = belts.paths.find(path => path.headX === seam - 2);
    const downstream = belts.paths.find(path => path.headX === seam && path.headY === 5);
    assert.ok(upstream !== undefined && downstream !== undefined, "the seam split the run in two");

    engine.ports.setItem(upstream.inPort, RED);
    let carried = false;
    for (let i = 0; i < 16 && !carried; i += 1) {
        engine.tickAll();
        carried = belts.itemsOf(downstream).some(item => item.type === RED);
    }
    assert.ok(carried, "the item crossed the seam into the bent segment");
    assert.equal(belts.itemsOf(upstream).length, 0, "and left the upstream segment");
});

// A tunnel crossing under a bend belt's head owns that edge as its own in-port; the surface path
// must leave it alone, or the one resting item would be ingested twice.
test("a tunnel crossing under a bend belt's head keeps its own in-port", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);

    // A surface belt flowing UP off the seam tile, so its right-hand side port is that tile's
    // RIGHT edge. Placed first, so it also holds the earlier slot in the ingest pass.
    const seam = CHUNK_SIZE;
    belts.placeBelt(seam, 4, Direction.UP);
    belts.placeBelt(seam, 5, Direction.UP);
    // A tunnel running RIGHT across the seam: its far segment's head is the buried (seam,5) tile,
    // whose in-port is that same RIGHT edge.
    belts.placeBelt(seam - 2, 5, Direction.RIGHT, BELT_TUNNEL_DOWN);
    belts.placeBelt(seam - 1, 5, Direction.RIGHT, BELT_UNDERGROUND);
    belts.placeBelt(seam, 5, Direction.RIGHT, BELT_UNDERGROUND);
    belts.placeBelt(seam + 1, 5, Direction.RIGHT, BELT_TUNNEL_UP);

    const tunnel = belts.paths.find(path => path.headX === seam && path.headY === 5
        && belts.beltById(path.beltIds[0]).type === BELT_UNDERGROUND);
    const surface = belts.paths.find(path => path.headX === seam && path.headY === 5
        && belts.beltById(path.beltIds[0]).type !== BELT_UNDERGROUND);
    assert.ok(tunnel !== undefined && surface !== undefined, "both paths start on the seam tile");

    engine.ports.setItem(tunnel.inPort, RED);
    let delivered = 0;
    let stolen = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.tickAll();
        if (engine.ports.item(tunnel.outPort) === RED) {
            delivered += 1;
            engine.ports.setItem(tunnel.outPort, EMPTY);
        }
        if (engine.ports.item(surface.outPort) === RED) {
            stolen += 1;
            engine.ports.setItem(surface.outPort, EMPTY);
        }
    }
    assert.equal(stolen, 0, "the surface belt never copied the buried item");
    assert.equal(belts.itemsOf(surface).length, 0, "and carries nothing");
    assert.equal(delivered, 1, "the tunnel delivered it once");
});
