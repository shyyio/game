import {
    AbstractModDeclaration,
    ObjectType,
    PortDefinition,
    PlacementRule,
    LaneBehavior,
    LANE_LEVEL_BURIED,
    LANE_LEVEL_ELEVATED_1,
    CreateObjectMessage,
    DeleteObjectMessage,
    ItemType,
    ItemCategory,
    Direction,
    CONVEYS_ITEM,
    LAYER_SURFACE,
    NO_EID,
} from "@/sdk/common.js";

/**
 * Test-only lane content (not part of any mod): a surface lane cell, the buried kinds a lane needs to
 * leave and re-enter the surface, and the same shape one level up. Core lane specs drive these, so
 * they never depend on a mod's belt and never inherit its content decisions.
 */

export const ITEM_TYPE_TEST_CARGO = 950;
export const ITEM_TYPE_TEST_CARGO_B = 951;
export const ITEM_TYPE_TEST_FLUID = 952;

// A lane cell's own edges: the two flanks and the straight back input, and the output past the tile.
const PORT_INPUT_LEFT = new PortDefinition("inputPortLeft", {x: 0, y: 0, direction: Direction.RIGHT});
const PORT_INPUT_BACK = new PortDefinition("inputPortBack", {x: 0, y: 0, direction: Direction.UP});
const PORT_INPUT_RIGHT = new PortDefinition("inputPortRight", {x: 0, y: 0, direction: Direction.LEFT});
// The lane registers its tail's output port for rendering itself, so the definition does not.
const PORT_OUTPUT = new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP}, false);

export const TestLaneType = new ObjectType({
    name: "TestLane",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Test Lane",
    conveys: CONVEYS_ITEM,
    placement: new PlacementRule({isConveyor: true}),
    inputPorts: [PORT_INPUT_LEFT, PORT_INPUT_BACK, PORT_INPUT_RIGHT],
    outputPorts: [PORT_OUTPUT],
    behavior: new LaneBehavior({}),
});

export const TestLaneDownType = new ObjectType({
    name: "TestLaneDown",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Test Lane Down",
    conveys: CONVEYS_ITEM,
    inputPorts: [PORT_INPUT_BACK],
    outputPorts: [PORT_OUTPUT],
    behavior: new LaneBehavior({outLevel: LANE_LEVEL_BURIED}),
});

export const TestLaneBuriedType = new ObjectType({
    name: "TestLaneBuried",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Test Lane Buried",
    conveys: CONVEYS_ITEM,
    inputPorts: [PORT_INPUT_BACK],
    outputPorts: [PORT_OUTPUT],
    behavior: new LaneBehavior({inLevel: LANE_LEVEL_BURIED, outLevel: LANE_LEVEL_BURIED}),
});

export const TestLaneUpType = new ObjectType({
    name: "TestLaneUp",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Test Lane Up",
    conveys: CONVEYS_ITEM,
    inputPorts: [PORT_INPUT_BACK],
    outputPorts: [PORT_OUTPUT],
    behavior: new LaneBehavior({inLevel: LANE_LEVEL_BURIED}),
});

export const TestLaneRampUpType = new ObjectType({
    name: "TestLaneRampUp",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Test Lane Ramp Up",
    conveys: CONVEYS_ITEM,
    inputPorts: [PORT_INPUT_BACK],
    outputPorts: [PORT_OUTPUT],
    behavior: new LaneBehavior({outLevel: LANE_LEVEL_ELEVATED_1}),
});

// Elevated cells bend, so they take the flanks a surface cell takes.
export const TestLaneElevatedType = new ObjectType({
    name: "TestLaneElevated",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Test Lane Elevated",
    conveys: CONVEYS_ITEM,
    inputPorts: [PORT_INPUT_LEFT, PORT_INPUT_BACK, PORT_INPUT_RIGHT],
    outputPorts: [PORT_OUTPUT],
    behavior: new LaneBehavior({inLevel: LANE_LEVEL_ELEVATED_1, outLevel: LANE_LEVEL_ELEVATED_1}),
});

export const TestLaneRampDownType = new ObjectType({
    name: "TestLaneRampDown",
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "Test Lane Ramp Down",
    conveys: CONVEYS_ITEM,
    inputPorts: [PORT_INPUT_BACK],
    outputPorts: [PORT_OUTPUT],
    behavior: new LaneBehavior({inLevel: LANE_LEVEL_ELEVATED_1}),
});

export class LaneFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "LaneFixture";
    }

    get objectTypes() {
        return [
            TestLaneType,
            TestLaneDownType,
            TestLaneBuriedType,
            TestLaneUpType,
            TestLaneRampUpType,
            TestLaneElevatedType,
            TestLaneRampDownType,
        ];
    }

    get items() {
        return [new ItemCategory("Lane Fixture", {
            [ITEM_TYPE_TEST_CARGO]: new ItemType("Test Cargo", "items/1-gray"),
            [ITEM_TYPE_TEST_CARGO_B]: new ItemType("Test Cargo B", "items/1-gray"),
            [ITEM_TYPE_TEST_FLUID]: new ItemType("Test Fluid", "items/1-gray"),
        })];
    }

    get fluidTypes() {
        return [ITEM_TYPE_TEST_FLUID];
    }
}

/**
 * Places one lane cell through the ordinary placement message.
 * @param {GameEngine} engine
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} direction
 * @param {ObjectType} [type]
 * @returns {number} the cell's eid, NO_EID when the placement was refused
 */
export function placeLane(engine, tileX, tileY, direction, type = TestLaneType) {
    const before = engine.placed.getEidsByTypeId(type.objectTypeId).length;
    engine.applyMessage(new CreateObjectMessage(type.objectTypeId, tileX, tileY, direction));
    if (engine.placed.getEidsByTypeId(type.objectTypeId).length === before) {
        return NO_EID;
    }
    return engine.placed.getEidAt(tileX, tileY, type.getPositionLayerTilesByDirection(direction)[0].layer);
}

/**
 * Deletes the cell at a tile through the ordinary delete message.
 * @param {GameEngine} engine
 * @param {number} tileX
 * @param {number} tileY
 * @param {string} [layer]
 * @returns {void}
 */
export function deleteLane(engine, tileX, tileY, layer = LAYER_SURFACE) {
    const eid = engine.placed.getEidAt(tileX, tileY, layer);
    engine.applyMessage(new DeleteObjectMessage(engine.placed.getObjectRefByEid(eid)));
}

/**
 * @param {GameEngine} engine
 * @param {number} laneRef
 * @returns {number[][]} the lane's cells as [tileX, tileY] pairs, head first
 */
export function laneTiles(engine, laneRef) {
    return engine.lanes.getCellEidsByLaneRef(laneRef).map(eid => [engine.Position.x[eid], engine.Position.y[eid]]);
}

/**
 * The lane covering a tile, or null when there is none.
 * @param {GameEngine} engine
 * @param {number} tileX
 * @param {number} tileY
 * @param {string} [layer]
 * @returns {number|null}
 */
export function getLaneRefAt(engine, tileX, tileY, layer = LAYER_SURFACE) {
    const eid = engine.placed.getEidAt(tileX, tileY, layer);
    if (eid === NO_EID) {
        return null;
    }
    return engine.lanes.getLaneRefByCellEid(eid);
}

/**
 * Every in-flight item on every lane.
 * @param {GameEngine} engine
 * @returns {number}
 */
export function itemCells(engine) {
    return engine.lanes.getLaneRefs().reduce((sum, laneRef) => sum + engine.lanes.getItemCountByLaneRef(laneRef), 0);
}
