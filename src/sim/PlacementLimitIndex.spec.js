import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, PLAYER_REF_NONE} from "@/common/constants.js";
import {NO_EID} from "@/sim/AbstractComponent.js";
import {makeGameEngine, makeGame} from "@/test/ecsSim.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {OwnPlacementLimitsSyncEvent, OwnPlacedCountEvent, PlacementLimitBonusGrantedEvent} from "@/common/PlacementLimitEvents.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {ObjectType} from "@/common/ObjectType.js";
import {PlacementLimitBonusType} from "@/common/PlacementLimitBonusType.js";

const LIMIT = 2;
const BONUS_AMOUNT = 3;
const ALICE = 7;

const LimitedType = new ObjectType({
    name: "LimitedObject",
    geometry: "1x1",
    textureName: "machine/1x1",
    label: "LimitedObject",
    initialPlacementLimit: LIMIT,
});

const FixtureBonus = new PlacementLimitBonusType("limit-fixture-bonus", "Fixture bonus", "LimitedObject", BONUS_AMOUNT);

class LimitDeclaration extends AbstractModDeclaration {

    get name() {
        return "LimitFixture";
    }

    get objectTypes() {
        return [LimitedType];
    }

    get placementLimitBonuses() {
        return [FixtureBonus];
    }
}

/**
 * @param {GameEngine} engine
 * @param {number} tileX
 * @param {number} placedBy
 * @returns {number}
 */
function spawnAt(engine, tileX, placedBy) {
    return engine.placed.spawn({objectTypeId: LimitedType.objectTypeId, tileX, tileY: 0, direction: Direction.UP, placedBy});
}

test("a player's placed count of a type rises on spawn and falls on despawn", async () => {
    const engine = await makeGameEngine([new ModPackage(new LimitDeclaration())]);
    const eid = spawnAt(engine, 0, ALICE);
    spawnAt(engine, 1, ALICE);
    assert.equal(engine.limits.getCountByPlayerRef(ALICE, LimitedType.objectTypeId), 2);
    engine.placed.despawn(eid);
    assert.equal(engine.limits.getCountByPlayerRef(ALICE, LimitedType.objectTypeId), 1);
});

test("placed counts rebuild from a deserialized snapshot", async () => {
    const a = await makeGameEngine([new ModPackage(new LimitDeclaration())]);
    spawnAt(a, 0, ALICE);
    spawnAt(a, 1, ALICE);
    const b = await makeGameEngine([new ModPackage(new LimitDeclaration())]);
    b.snapshots.deserialize(JSON.parse(JSON.stringify(a.snapshots.serialize())));
    assert.equal(b.limits.getCountByPlayerRef(ALICE, LimitedType.objectTypeId), 2);
});

test("a granted bonus raises a player's limit over the type's initial one, once", async () => {
    const engine = await makeGameEngine([new ModPackage(new LimitDeclaration())]);
    assert.equal(engine.limits.getLimitByPlayerRef(ALICE, LimitedType.objectTypeId), LIMIT);
    assert.equal(engine.limits.isGranted(ALICE, FixtureBonus.bonusTypeId), false);
    engine.limits.grant(ALICE, FixtureBonus.bonusTypeId);
    assert.equal(engine.limits.isGranted(ALICE, FixtureBonus.bonusTypeId), true);
    assert.equal(engine.limits.getLimitByPlayerRef(ALICE, LimitedType.objectTypeId), LIMIT + BONUS_AMOUNT);
    assert.throws(() => engine.limits.grant(ALICE, FixtureBonus.bonusTypeId), /already granted/);
});

test("a player at their limit is refused a spawn while the engine is not", async () => {
    const engine = await makeGameEngine([new ModPackage(new LimitDeclaration())]);
    spawnAt(engine, 0, ALICE);
    spawnAt(engine, 1, ALICE);
    assert.equal(engine.limits.isAtLimit(ALICE, LimitedType.objectTypeId), true);
    assert.equal(spawnAt(engine, 2, ALICE), NO_EID);
    assert.notEqual(spawnAt(engine, 3, PLAYER_REF_NONE), NO_EID);
    engine.limits.grant(ALICE, FixtureBonus.bonusTypeId);
    assert.notEqual(spawnAt(engine, 4, ALICE), NO_EID);
});

test("granted bonuses survive a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([new ModPackage(new LimitDeclaration())], store);
    game.simEngine.limits.grant(ALICE, FixtureBonus.bonusTypeId);
    await game.save();

    const restored = await makeGame([new ModPackage(new LimitDeclaration())], store);
    assert.equal(await restored.load(), true);
    assert.equal(restored.simEngine.limits.isGranted(ALICE, FixtureBonus.bonusTypeId), true);
});

test("a connecting session is told its counts over the limited types and its bonuses", async () => {
    const game = await makeGame([new ModPackage(new LimitDeclaration())]);
    const engine = game.simEngine;
    spawnAt(engine, 0, ALICE);
    engine.limits.grant(ALICE, FixtureBonus.bonusTypeId);
    const alice = new CapturingSession(ALICE);
    game.connect(alice);
    const sync = alice.events.find(event => event instanceof OwnPlacementLimitsSyncEvent);
    const limitedIndex = game.modRegistry.limitedObjectTypes.indexOf(LimitedType);
    assert.notEqual(limitedIndex, -1);
    assert.equal(sync.ownCounts[limitedIndex], 1);
    assert.deepEqual(sync.ownBonusTypeIds, [FixtureBonus.bonusTypeId]);
});

test("a spawn, a despawn and a grant each reach the player's sessions as own events", async () => {
    const game = await makeGame([new ModPackage(new LimitDeclaration())]);
    const engine = game.simEngine;
    const alice = new CapturingSession(ALICE);
    const bob = new CapturingSession(ALICE + 1);
    game.connect(alice);
    game.connect(bob);
    alice.events.length = 0;
    bob.events.length = 0;

    const eid = spawnAt(engine, 0, ALICE);
    engine.placed.despawn(eid);
    engine.limits.grant(ALICE, FixtureBonus.bonusTypeId);

    const counts = alice.events.filter(event => event instanceof OwnPlacedCountEvent);
    assert.deepEqual(counts.map(event => [event.objectTypeId, event.ownCount]), [
        [LimitedType.objectTypeId, 1],
        [LimitedType.objectTypeId, 0],
    ]);
    const granted = alice.events.filter(event => event instanceof PlacementLimitBonusGrantedEvent);
    assert.deepEqual(granted.map(event => event.bonusTypeId), [FixtureBonus.bonusTypeId]);
    assert.equal(bob.events.length, 0);
});
