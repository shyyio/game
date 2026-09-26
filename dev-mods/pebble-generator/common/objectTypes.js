import {ObjectType, PortDefinition, PlacementRule, GeneratorBehavior, Direction, PlacementLimitBonusType} from "@spup/sdk";
import {ITEM_TYPE_PEBBLE, TOOL_ID_PEBBLE_GENERATOR, GENERATOR_TICKS, GENERATOR_LIMIT, FIRST_GENERATOR_BONUS} from "./constants.js";

/**
 * A machine players can build: it takes nothing in and pushes a pebble out of its top side, where
 * a belt can pick it up. The engine derives its sprite, toolbar button, placement ghost and
 * inspect panel from this definition; the behavior is what it does each tick.
 */
export const PebbleGeneratorType = new ObjectType({
    name: "PebbleGenerator",
    toolId: TOOL_ID_PEBBLE_GENERATOR,
    // One tile above the machine, facing away from it; positions are relative to the machine.
    outputPorts: [new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    textureName: "pebble-generator/machine",
    label: "Pebble Generator",
    inspectable: true,
    placement: new PlacementRule({shouldReplaceSameKind: true}),
    // How many a player may have standing; the bonus below raises it.
    initialPlacementLimit: GENERATOR_LIMIT,
    behavior: new GeneratorBehavior({
        processingTicks: GENERATOR_TICKS,
        output: ITEM_TYPE_PEBBLE,
    }),
});

/**
 * A reward the server half of the mod grants: more generators for the player who builds their
 * first. The registry resolves the object type by name; the player sees the label.
 */
export const FirstGeneratorBonus = new PlacementLimitBonusType("pebble-generator-first", "First pebble generator", "PebbleGenerator", FIRST_GENERATOR_BONUS);
