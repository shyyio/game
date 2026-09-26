import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientCache} from "@/client/state/ClientCache.js";
import {PLACEMENT_LIMITS_SCHEMA, PlacementLimitsWriter, PlacementLimitsView} from "@/client/state/PlacementLimitsState.js";
import {OwnPlacementLimitsSyncEvent, OwnPlacedCountEvent, PlacementLimitBonusGrantedEvent} from "@/common/PlacementLimitEvents.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {ObjectType} from "@/common/ObjectType.js";
import {PlacementLimitBonusType} from "@/common/PlacementLimitBonusType.js";

const LIMIT = 2;
const BONUS_AMOUNT = 3;

const FreeType = new ObjectType({name: "Free", geometry: "1x1", textureName: "machine/1x1", label: "Free"});
const LimitedType = new ObjectType({name: "Limited", geometry: "1x1", textureName: "machine/1x1", label: "Limited", initialPlacementLimit: LIMIT});
const FixtureBonus = new PlacementLimitBonusType("limit-fixture-bonus", "Fixture bonus", "Limited", BONUS_AMOUNT);

class LimitDeclaration extends AbstractModDeclaration {

    get name() {
        return "LimitFixture";
    }

    get objectTypes() {
        return [FreeType, LimitedType];
    }

    get placementLimitBonuses() {
        return [FixtureBonus];
    }
}

function setup() {
    const modRegistry = new ModRegistry();
    modRegistry.register(new ModPackage(new LimitDeclaration()));
    modRegistry.freeze();
    const cache = new ClientCache();
    const view = new PlacementLimitsView(modRegistry);
    cache.register("placementLimits", PLACEMENT_LIMITS_SCHEMA, new PlacementLimitsWriter(modRegistry, cache), view);
    return {cache, view};
}

test("the sync zips counts against the limited types and the deltas move them", () => {
    const {cache, view} = setup();
    cache.onEvent(new OwnPlacementLimitsSyncEvent([1], []));
    assert.equal(view.getCountByTypeId(LimitedType.objectTypeId), 1);
    assert.equal(view.getRemainingByTypeId(LimitedType.objectTypeId), LIMIT - 1);
    assert.equal(view.isAtLimit(LimitedType.objectTypeId), false);
    cache.onEvent(new OwnPlacedCountEvent(LimitedType.objectTypeId, LIMIT));
    assert.equal(view.isAtLimit(LimitedType.objectTypeId), true);
    assert.equal(view.isAtLimit(FreeType.objectTypeId), false);
});

test("a granted bonus raises the limit", () => {
    const {cache, view} = setup();
    cache.onEvent(new OwnPlacementLimitsSyncEvent([LIMIT], []));
    assert.equal(view.getLimitByTypeId(LimitedType.objectTypeId), LIMIT);
    cache.onEvent(new PlacementLimitBonusGrantedEvent(FixtureBonus.bonusTypeId));
    assert.equal(view.getLimitByTypeId(LimitedType.objectTypeId), LIMIT + BONUS_AMOUNT);
    assert.equal(view.isAtLimit(LimitedType.objectTypeId), false);
});
