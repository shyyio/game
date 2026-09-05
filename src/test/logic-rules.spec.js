import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LOGIC_KEY_ENABLED, LOGIC_KEY_PROCESSING} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkId} from "@/common/util.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGame, ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {GateDefinition, PoleDefinition, LogicTerminalDefinition} from "@/mods/logistics/common/objectTypes.js";
import {BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_NUTRIENT_SLOP} from "@/mods/base-game/common/constants.js";
import {
    WireLinkMessage,
    ConfigureLogicRulesMessage,
    LogicSnapshotRequestMessage,
} from "@/mods/logistics/common/messages.js";
import {LogicSnapshotEvent} from "@/mods/logistics/common/events.js";
import {
    LogicRule,
    LogicRules,
    deviceCondition,
    storedCondition,
} from "@/mods/logistics/sim/LogicRules.js";
import {
    LOGIC_KEY_OPEN,
    LOGIC_COMPARATOR_AT_LEAST,
    LOGIC_COMPARATOR_EXACTLY,
    LOGIC_RULE_CAP,
    LOGIC_CONDITION_CAP,
    LOGIC_CONDITION_KIND_STORED,
} from "@/mods/logistics/common/constants.js";
import {TankDefinition} from "@/mods/fluids/common/objectTypes.js";
import {LOGIC_KEY_AMOUNT, FLUID_TYPE_WATER} from "@/mods/fluids/common/constants.js";

/**
 * Places an object and returns its objectId (the newest placed row's).
 */
function place(engine, type, x, y, direction=Direction.UP) {
    assert.equal(engine.applyMessage(new CreateObjectMessage(type.typeId, x, y, direction)), true);
    const def = engine.placed.def;
    return def.store.objectId[def.row(def.eids[def.count - 1])];
}

/**
 * A connected session holding build rights on the chunk at (5, 5).
 */
function claimedPlayer(game) {
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), player);
    return player;
}

/**
 * The configure message for a LogicRule list, flattened like the client writer sends it.
 */
function rulesMessage(terminalId, rules) {
    const conditions = rules.flatMap(rule => rule.conditions);
    return new ConfigureLogicRulesMessage(
        terminalId,
        rules.map(rule => rule.actionDeviceId),
        rules.map(rule => rule.actionKey),
        rules.map(rule => rule.actionValue),
        rules.map(rule => rule.conditions.length),
        conditions.map(condition => condition.kind),
        conditions.map(condition => condition.deviceId),
        conditions.map(condition => condition.itemType),
        conditions.map(condition => condition.key),
        conditions.map(condition => condition.comparator),
        conditions.map(condition => condition.value),
    );
}

/**
 * A component column value for a placed objectId.
 */
function columnOf(engine, componentName, column, objectId) {
    const def = engine.components.get(componentName);
    return def.store[column][def.row(engine.placed.eidByObjectId(objectId))];
}

/**
 * Fills a placed tank directly.
 */
function fillTank(engine, tankId, fluidType, amount) {
    const def = engine.components.get("Tank");
    const row = def.row(engine.placed.eidByObjectId(tankId));
    def.store.fluidType[row] = fluidType;
    def.store.amount[row] = amount;
}

test("a rule whose conditions hold writes its action the same tick", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gateA = place(engine, GateDefinition, 8, 5, Direction.UP);
    const gateB = place(engine, GateDefinition, 10, 5, Direction.UP);
    for (const id of [terminal, gateA, gateB]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }

    // While gate A is open, hold gate B closed.
    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gateB, LOGIC_KEY_OPEN, 0, [
            deviceCondition(gateA, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_EXACTLY, 1),
        ]),
    ]), player);
    engine.tickAll();
    assert.equal(columnOf(engine, "Gate", "open", gateB), 0, "the rule closed gate B");
    assert.equal(columnOf(engine, "Gate", "open", gateA), 1, "the condition gate is untouched");
});

test("a condition-less rule always applies, and a failing condition stops the write", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gateA = place(engine, GateDefinition, 8, 5, Direction.UP);
    const gateB = place(engine, GateDefinition, 10, 5, Direction.UP);
    const machine = place(engine, BlenderType, 10, 8, Direction.UP);
    for (const id of [terminal, gateA, gateB, machine]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }

    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(machine, LOGIC_KEY_ENABLED, 0, []),
        new LogicRule(gateB, LOGIC_KEY_OPEN, 0, [
            deviceCondition(gateA, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_EXACTLY, 0),
        ]),
    ]), player);
    engine.tickAll();
    assert.equal(columnOf(engine, "Machine", "enabled", machine), 0, "the condition-less rule fired");
    assert.equal(columnOf(engine, "Gate", "open", gateB), 1, "gate A is open, so the close never ran");
});

test("the processing key reads real activity, not the enable switch", async () => {
    const game = await makeGame();
    const engine = game.simEngine;
    const machine = place(engine, BlenderType, 10, 8, Direction.UP);
    const eid = engine.placed.eidByObjectId(machine);
    const behavior = engine.placed.behaviorFor(engine.placed.typeIdOf(eid));

    assert.equal(behavior.logicRead(engine, eid, LOGIC_KEY_ENABLED), 1);
    assert.equal(behavior.logicRead(engine, eid, LOGIC_KEY_PROCESSING), 0,
        "enabled but holding nothing reads idle");

    const def = engine.components.get("Machine");
    def.store.output[def.row(eid)] = ITEM_TYPE_NUTRIENT_SLOP;
    assert.equal(behavior.logicRead(engine, eid, LOGIC_KEY_PROCESSING), 1,
        "a held product is a craft in flight");

    behavior.logicWrite(engine, eid, LOGIC_KEY_ENABLED, 0);
    assert.equal(behavior.logicRead(engine, eid, LOGIC_KEY_PROCESSING), 0,
        "a switched-off machine is frozen, not working");
});

test("all conditions must hold (AND)", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gateA = place(engine, GateDefinition, 8, 5, Direction.UP);
    const gateB = place(engine, GateDefinition, 10, 5, Direction.UP);
    const gateC = place(engine, GateDefinition, 12, 5, Direction.UP);
    for (const id of [terminal, gateA, gateB, gateC]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }

    // Gate A is open (holds) but gate B is not closed (fails): no write.
    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gateC, LOGIC_KEY_OPEN, 0, [
            deviceCondition(gateA, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_EXACTLY, 1),
            deviceCondition(gateB, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_EXACTLY, 0),
        ]),
    ]), player);
    engine.tickAll();
    assert.equal(columnOf(engine, "Gate", "open", gateC), 1, "one failing condition vetoed the write");
});

test("a stored condition sums the item across every storage in the network", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gate = place(engine, GateDefinition, 8, 5, Direction.UP);
    const tankA = place(engine, TankDefinition, 10, 8, Direction.UP);
    const tankB = place(engine, TankDefinition, 13, 8, Direction.UP);
    for (const id of [terminal, gate, tankA, tankB]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }
    fillTank(engine, tankA, FLUID_TYPE_WATER, 50);
    fillTank(engine, tankB, FLUID_TYPE_WATER, 40);

    // With at least 100 water stored across the network, close the gate.
    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gate, LOGIC_KEY_OPEN, 0, [
            storedCondition(FLUID_TYPE_WATER, LOGIC_COMPARATOR_AT_LEAST, 100),
        ]),
    ]), player);
    engine.tickAll();
    assert.equal(columnOf(engine, "Gate", "open", gate), 1, "90 stored is under the threshold");

    // Refill both: the first tick moved one unit from each tank into its out port.
    fillTank(engine, tankA, FLUID_TYPE_WATER, 50);
    fillTank(engine, tankB, FLUID_TYPE_WATER, 50);
    engine.tickAll();
    assert.equal(columnOf(engine, "Gate", "open", gate), 0, "50 + 50 across two tanks triggered");
});

test("a container-filtered stored condition counts only that container", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gate = place(engine, GateDefinition, 8, 5, Direction.UP);
    const tankA = place(engine, TankDefinition, 10, 8, Direction.UP);
    const tankB = place(engine, TankDefinition, 13, 8, Direction.UP);
    for (const id of [terminal, gate, tankA, tankB]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }
    fillTank(engine, tankA, FLUID_TYPE_WATER, 30);
    fillTank(engine, tankB, FLUID_TYPE_WATER, 80);

    // Only tank A's 30 counts; the network total of 110 must not trigger it.
    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gate, LOGIC_KEY_OPEN, 0, [
            storedCondition(FLUID_TYPE_WATER, LOGIC_COMPARATOR_AT_LEAST, 100, tankA),
        ]),
    ]), player);
    engine.tickAll();
    assert.equal(columnOf(engine, "Gate", "open", gate), 1, "tank A alone is under the threshold");

    fillTank(engine, tankA, FLUID_TYPE_WATER, 120);
    engine.tickAll();
    assert.equal(columnOf(engine, "Gate", "open", gate), 0, "tank A crossing it triggered");
});

test("the topmost rule writing a device wins the tick", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gateB = place(engine, GateDefinition, 10, 5, Direction.UP);
    for (const id of [terminal, gateB]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }

    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gateB, LOGIC_KEY_OPEN, 0, []),
        new LogicRule(gateB, LOGIC_KEY_OPEN, 1, []),
    ]), player);
    engine.tickAll();
    assert.equal(columnOf(engine, "Gate", "open", gateB), 0, "the first rule claimed gate B");
});

test("a rule referencing a device outside the network suspends without writing", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gateB = place(engine, GateDefinition, 10, 5, Direction.UP);
    // Placed but never wired: not a network member.
    const strayGate = place(engine, GateDefinition, 8, 5, Direction.UP);
    for (const id of [terminal, gateB]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }

    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gateB, LOGIC_KEY_OPEN, 0, [
            deviceCondition(strayGate, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_AT_LEAST, 0),
        ]),
    ]), player);
    engine.tickAll();
    const rules = engine.resolve(LogicRules).rulesOf(terminal);
    assert.equal(rules[0].suspended, true, "the stray condition device suspended the rule");
    assert.equal(columnOf(engine, "Gate", "open", gateB), 1, "the action never ran");
});

test("an over-cap or wrong-shape rule list is rejected whole", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gate = place(engine, GateDefinition, 8, 5, Direction.UP);
    for (const id of [terminal, gate]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }

    const overCap = Array(LOGIC_RULE_CAP + 1).fill(null)
        .map(() => new LogicRule(gate, LOGIC_KEY_OPEN, 0, []));
    game.dispatchMessage(rulesMessage(terminal, overCap), player);
    assert.equal(engine.resolve(LogicRules).rulesOf(terminal).length, 0, "over the rule cap");

    const overConditions = new LogicRule(gate, LOGIC_KEY_OPEN, 0, Array(LOGIC_CONDITION_CAP + 1)
        .fill(null).map(() => deviceCondition(gate, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_AT_LEAST, 0)));
    game.dispatchMessage(rulesMessage(terminal, [overConditions]), player);
    assert.equal(engine.resolve(LogicRules).rulesOf(terminal).length, 0, "over the condition cap");

    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gate, LOGIC_KEY_OPEN, 0, [
            deviceCondition(gate, LOGIC_KEY_OPEN, 99, 0),
        ]),
    ]), player);
    assert.equal(engine.resolve(LogicRules).rulesOf(terminal).length, 0, "unknown comparator");
});

test("rules and their conditions persist through a save/load and keep running", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gateA = place(engine, GateDefinition, 8, 5, Direction.UP);
    const gateB = place(engine, GateDefinition, 10, 5, Direction.UP);
    for (const id of [terminal, gateA, gateB]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }
    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gateB, LOGIC_KEY_OPEN, 0, [
            deviceCondition(gateA, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_EXACTLY, 1),
        ]),
    ]), player);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const rules = restored.simEngine.resolve(LogicRules).rulesOf(terminal);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].actionDeviceId, gateB);
    assert.equal(rules[0].conditions.length, 1);
    assert.equal(rules[0].conditions[0].deviceId, gateA);
    restored.simEngine.tickAll();
    assert.equal(columnOf(restored.simEngine, "Gate", "open", gateB), 0, "the restored rule still fires");
});

test("behaviors declare their logic key lists and the registry names the keys", () => {
    const modRegistry = ecsModRegistry();
    assert.deepEqual(GateDefinition.behavior.logicReadKeys(), [LOGIC_KEY_OPEN]);
    assert.deepEqual(GateDefinition.behavior.logicWriteKeys(), [LOGIC_KEY_OPEN]);
    assert.deepEqual(BlenderType.behavior.logicReadKeys(), [LOGIC_KEY_ENABLED, LOGIC_KEY_PROCESSING]);
    assert.deepEqual(BlenderType.behavior.logicWriteKeys(), [LOGIC_KEY_ENABLED], "processing is read-only");
    assert.deepEqual(TankDefinition.behavior.logicReadKeys(), [LOGIC_KEY_AMOUNT]);
    assert.deepEqual(TankDefinition.behavior.logicWriteKeys(), [], "the tank amount is read-only");
    assert.equal(modRegistry.logicKeyName(LOGIC_KEY_ENABLED), "Enabled");
    assert.equal(modRegistry.logicKeyEntry(LOGIC_KEY_OPEN).states[0].verb, "Open");
    assert.equal(modRegistry.logicKeyEntry(LOGIC_KEY_OPEN).states[1].state, "is closed");
    assert.equal(modRegistry.logicKeyEntry(LOGIC_KEY_ENABLED).states[0].verb, "Enable");
    assert.equal(modRegistry.logicKeyEntry(LOGIC_KEY_AMOUNT).states, null, "amount is numeric");
    assert.throws(() => modRegistry.logicKeyName(9999));
});

test("the snapshot carries rules, their conditions, and suspended flags", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gateB = place(engine, GateDefinition, 10, 5, Direction.UP);
    const strayGate = place(engine, GateDefinition, 8, 5, Direction.UP);
    for (const id of [terminal, gateB]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }
    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gateB, LOGIC_KEY_OPEN, 1, [
            storedCondition(FLUID_TYPE_WATER, LOGIC_COMPARATOR_AT_LEAST, 100),
            deviceCondition(gateB, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_EXACTLY, 0),
        ]),
        new LogicRule(gateB, LOGIC_KEY_OPEN, 0, [
            deviceCondition(strayGate, LOGIC_KEY_OPEN, LOGIC_COMPARATOR_EXACTLY, 1),
        ]),
    ]), player);
    engine.tickAll();

    player.events.length = 0;
    game.dispatchMessage(new LogicSnapshotRequestMessage(terminal), player);
    const snapshot = player.events.find(event => event instanceof LogicSnapshotEvent);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.ruleActionDeviceIds, [gateB, gateB]);
    assert.deepEqual(snapshot.ruleConditionCounts, [2, 1]);
    assert.deepEqual(snapshot.condKinds[0], LOGIC_CONDITION_KIND_STORED);
    assert.deepEqual(snapshot.condItemTypes[0], FLUID_TYPE_WATER);
    assert.deepEqual(snapshot.condDeviceIds[2], strayGate);
    assert.deepEqual(snapshot.ruleSuspended, [0, 1], "the stray-device rule reports suspended");
});

test("removing a terminal drops its rules", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, LogicTerminalDefinition, 6, 5);
    const gate = place(engine, GateDefinition, 8, 5, Direction.UP);
    for (const id of [terminal, gate]) {
        game.dispatchMessage(new WireLinkMessage(id, pole), player);
    }
    game.dispatchMessage(rulesMessage(terminal, [
        new LogicRule(gate, LOGIC_KEY_OPEN, 0, []),
    ]), player);
    assert.equal(engine.resolve(LogicRules).rulesOf(terminal).length, 1);

    engine.applyMessage(new DeleteObjectMessage(terminal));
    assert.equal(engine.resolve(LogicRules).rulesOf(terminal).length, 0);
});
