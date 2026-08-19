import {
    ObjectType,
    PortDefinition,
    RecipeDefinition,
    RecipeByproduct,
    PlacementRule,
    ResourceBehavior,
    ExtractorBehavior,
    MachineBehavior,
    GeneratorBehavior,
    Direction,
} from "@spup/sdk";
import {
    RESOURCE_WATER,
    RESOURCE_GRAVEYARD,
    RESOURCE_OXIDE,
    RESOURCE_COAL,
    RESOURCE_QUARTZ,
    ITEM_TYPE_WATER,
    ITEM_TYPE_SOUL,
    ITEM_TYPE_SOYBEAN_SEEDS,
    ITEM_TYPE_SOYBEAN,
    ITEM_TYPE_MUSHROOM_SPORE,
    ITEM_TYPE_MUSHROOM,
    ITEM_TYPE_NUTRIENT_SLOP,
    ITEM_TYPE_CREATURE,
    ITEM_TYPE_ADRENOCHROME,
    ITEM_TYPE_BASIC_POTION_BASE,
    ITEM_TYPE_OVERLOAD_MIX,
    ITEM_TYPE_IRON_ORE,
    ITEM_TYPE_COAL,
    ITEM_TYPE_COKE,
    ITEM_TYPE_OXYGEN,
    ITEM_TYPE_RAW_STEEL,
    ITEM_TYPE_STEEL_PARTS,
    ITEM_TYPE_SAND,
    ITEM_TYPE_GLASS,
    ITEM_TYPE_EMPTY_SYRINGE,
    ITEM_TYPE_STIMPACK,
    ITEM_TYPE_WASTE,
    TORMENT_CHAMBER_SOUL_CHANCE,
    BLENDER_WORKER_COST,
} from "./constants.js";

// ---- Resource bodies ----
// Simple 1x1 non-solid tile; shared Extractor sits on top.

function resourceBody(name, label, resourceType, toolId) {
    return new ObjectType({
        name,
        geometry: "1x1",
        textureName: "resource/placeholder",
        directional: false,
        label,
        extractionTiles: [{x: 0, y: 0}],
        placement: new PlacementRule({solid: false}),
        behavior: new ResourceBehavior({resourceType}),
        toolId,
    });
}

export const WaterResourceType = resourceBody("WaterResource", "Water", RESOURCE_WATER, 10);
export const GraveyardResourceType = resourceBody("Graveyard", "Graveyard", RESOURCE_GRAVEYARD, 11);
export const OxideDepositResourceType = resourceBody("OxideDeposit", "Oxide Ore Deposit", RESOURCE_OXIDE, 12);
export const CoalDepositResourceType = resourceBody("CoalDeposit", "Coal Deposit", RESOURCE_COAL, 13);
export const QuartzDepositResourceType = resourceBody("QuartzDeposit", "Quartz Deposit", RESOURCE_QUARTZ, 14);

export const RESOURCE_TYPES = [
    WaterResourceType,
    GraveyardResourceType,
    OxideDepositResourceType,
    CoalDepositResourceType,
    QuartzDepositResourceType,
];

// ---- Primary extraction ----
// Shared Extractor type: the "Primary Extraction" agent, reused for every resource.

export const ExtractorType = new ObjectType({
    name: "Extractor",
    toolId: 15,
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "demo-machine/0",
    label: "Extractor",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true, placeOn: RESOURCE_TYPES}),
    behavior: new ExtractorBehavior({
        processingTicks: 4,
        recipes: [
            new RecipeDefinition([RESOURCE_WATER], ITEM_TYPE_WATER),
            new RecipeDefinition([RESOURCE_GRAVEYARD], ITEM_TYPE_SOUL),
            new RecipeDefinition([RESOURCE_OXIDE], ITEM_TYPE_IRON_ORE),
            new RecipeDefinition([RESOURCE_COAL], ITEM_TYPE_COAL),
            new RecipeDefinition([RESOURCE_QUARTZ], ITEM_TYPE_SAND),
        ],
    }),
});

// ---- Machines ----
// Ports face bottom (inputs) or top (outputs), never a side. Single port at column x=0 on 1x1;
// second port widens footprint to "1x2" at column x=1.

const IN_A = new PortDefinition("in_a", {x: 0, y: 0, direction: Direction.UP});
const IN_B = new PortDefinition("in_b", {x: 1, y: 0, direction: Direction.UP});
const IN_B_FLUID = new PortDefinition("in_b", {x: 1, y: 0, direction: Direction.UP}, true, true);
const OUT_A = new PortDefinition("out_a", {x: 0, y: -1, direction: Direction.UP});
const OUT_B = new PortDefinition("out_b", {x: 1, y: -1, direction: Direction.UP});

// 2x2 footprint: bottom row is y=1. `fluid` flag (4th PortDefinition arg) opts a port into
// engine.markFluidPort (see MachineBehavior.onSpawn/onDespawn).
const IN2_A = new PortDefinition("in_a", {x: 0, y: 1, direction: Direction.UP});
const IN2_B = new PortDefinition("in_b", {x: 1, y: 1, direction: Direction.UP});
const IN2_B_FLUID = new PortDefinition("in_b", {x: 1, y: 1, direction: Direction.UP}, true, true);
const OUT2_A = new PortDefinition("out_a", {x: 0, y: -1, direction: Direction.UP});
const OUT2_B = new PortDefinition("out_b", {x: 1, y: -1, direction: Direction.UP});

// 3x3 footprint (Greenhouse/SpawningPool/BlastFurnace): bottom row is y=2, three columns available;
// a single output centers at x=1.
const IN3_A = new PortDefinition("in_a", {x: 0, y: 2, direction: Direction.UP});
const IN3_A_FLUID = new PortDefinition("in_a", {x: 0, y: 2, direction: Direction.UP}, true, true);
const IN3_MID = new PortDefinition("in_mid", {x: 1, y: 2, direction: Direction.UP});
const IN3_B = new PortDefinition("in_b", {x: 2, y: 2, direction: Direction.UP});
const IN3_B_FLUID = new PortDefinition("in_b", {x: 2, y: 2, direction: Direction.UP}, true, true);
const OUT3_A = new PortDefinition("out_a", {x: 1, y: -1, direction: Direction.UP});

// Placeholder texture per footprint size. 1x2/3x3 frames are Housing's 2x2 art 9-sliced to size —
// see src/mods/BaseTextures/sprites/main/housing/.
const TEXTURE_BY_GEOMETRY = {
    "1x1": "demo-machine/0",
    "1x2": "housing/0-1x2",
    "2x2": "housing/0",
    "3x3": "housing/0-3x3",
};

function machine(name, label, {toolId, inputPorts, outputPorts, recipes, processingTicks, workerCost=0, geometry="1x1"}) {
    return new ObjectType({
        name,
        toolId,
        inputPorts,
        outputPorts,
        geometry,
        renderConnections: true,
        textureName: TEXTURE_BY_GEOMETRY[geometry],
        label,
        inspectable: true,
        placement: new PlacementRule({replaceSameKind: true}),
        behavior: new MachineBehavior({processingTicks, recipes, fallback: ITEM_TYPE_WASTE, workerCost}),
    });
}

export const GreenhouseType = machine("Greenhouse", "Greenhouse", {
    toolId: 16,
    inputPorts: [IN3_A, IN3_B_FLUID],
    outputPorts: [OUT3_A],
    geometry: "3x3",
    processingTicks: 6,
    recipes: [
        new RecipeDefinition([ITEM_TYPE_SOYBEAN_SEEDS, ITEM_TYPE_WATER], ITEM_TYPE_SOYBEAN),
        new RecipeDefinition([ITEM_TYPE_MUSHROOM_SPORE, ITEM_TYPE_WATER], ITEM_TYPE_MUSHROOM),
    ],
});

export const BlenderType = machine("Blender", "Blender", {
    toolId: 17,
    inputPorts: [IN2_A],
    outputPorts: [OUT2_A],
    geometry: "2x2",
    processingTicks: 2,
    recipes: [new RecipeDefinition([ITEM_TYPE_SOYBEAN], ITEM_TYPE_NUTRIENT_SLOP)],
    workerCost: BLENDER_WORKER_COST,
});

export const SpawningPoolType = machine("SpawningPool", "Spawning Pool", {
    toolId: 18,
    inputPorts: [IN3_A_FLUID, IN3_B],
    outputPorts: [OUT3_A],
    geometry: "3x3",
    processingTicks: 8,
    recipes: [new RecipeDefinition([ITEM_TYPE_NUTRIENT_SLOP, ITEM_TYPE_SOUL], ITEM_TYPE_CREATURE)],
});

export const TormentChamberType = machine("TormentChamber", "Torment Chamber", {
    toolId: 19,
    inputPorts: [IN2_A],
    outputPorts: [OUT2_A, OUT2_B],
    geometry: "2x2",
    processingTicks: 6,
    recipes: [
        new RecipeDefinition(
            [ITEM_TYPE_CREATURE],
            ITEM_TYPE_ADRENOCHROME,
            new RecipeByproduct(ITEM_TYPE_SOUL, TORMENT_CHAMBER_SOUL_CHANCE),
        ),
    ],
});

// Fluid-side port carries Water or BasicPotionBase, both fluids — no port-role conflict.
export const BrewType = machine("Brew", "Brew", {
    toolId: 20,
    inputPorts: [IN2_A, IN2_B_FLUID],
    outputPorts: [OUT2_A],
    geometry: "2x2",
    processingTicks: 6,
    recipes: [
        new RecipeDefinition([ITEM_TYPE_MUSHROOM, ITEM_TYPE_WATER], ITEM_TYPE_BASIC_POTION_BASE),
        new RecipeDefinition([ITEM_TYPE_ADRENOCHROME, ITEM_TYPE_BASIC_POTION_BASE], ITEM_TYPE_OVERLOAD_MIX),
    ],
});

export const BakeType = machine("Bake", "Bake", {
    toolId: 21,
    inputPorts: [IN_A],
    outputPorts: [OUT_A],
    processingTicks: 5,
    recipes: [
        new RecipeDefinition([ITEM_TYPE_COAL], ITEM_TYPE_COKE),
        new RecipeDefinition([ITEM_TYPE_SAND], ITEM_TYPE_GLASS),
    ],
});

// Coke (solid) and Oxygen (fluid) can't share a port role, so one recipe gets three dedicated
// ports (3x3) instead of two recipes. PigIron isn't a transportable item, just the in-between state.
export const BlastFurnaceType = machine("BlastFurnace", "Blast Furnace", {
    toolId: 22,
    inputPorts: [IN3_A, IN3_MID, IN3_B_FLUID],
    outputPorts: [OUT3_A],
    geometry: "3x3",
    processingTicks: 8,
    recipes: [new RecipeDefinition([ITEM_TYPE_IRON_ORE, ITEM_TYPE_COKE, ITEM_TYPE_OXYGEN], ITEM_TYPE_RAW_STEEL)],
});

export const FormingMachineType = machine("FormingMachine", "Forming Machine", {
    toolId: 23,
    inputPorts: [IN2_A],
    outputPorts: [OUT2_A],
    geometry: "2x2",
    processingTicks: 5,
    recipes: [new RecipeDefinition([ITEM_TYPE_RAW_STEEL], ITEM_TYPE_STEEL_PARTS)],
});

export const DelicateAssemblyType = machine("DelicateAssembly", "Delicate Assembly", {
    toolId: 24,
    inputPorts: [IN2_A, IN2_B],
    outputPorts: [OUT2_A],
    geometry: "2x2",
    processingTicks: 6,
    recipes: [new RecipeDefinition([ITEM_TYPE_STEEL_PARTS, ITEM_TYPE_GLASS], ITEM_TYPE_EMPTY_SYRINGE)],
});

export const FillType = machine("Fill", "Fill", {
    toolId: 25,
    inputPorts: [IN_A, IN_B_FLUID],
    outputPorts: [OUT_A],
    geometry: "1x2",
    processingTicks: 4,
    recipes: [new RecipeDefinition([ITEM_TYPE_EMPTY_SYRINGE, ITEM_TYPE_OVERLOAD_MIX], ITEM_TYPE_STIMPACK)],
});

// ---- Air Filter ----
// No input: passive generator (filters ambient air). Oxygen main output, Water a slow trickle.

export const AirFilterType = new ObjectType({
    name: "AirFilter",
    toolId: 26,
    outputPorts: [OUT2_A, OUT2_B],
    geometry: "2x2",
    renderConnections: true,
    textureName: TEXTURE_BY_GEOMETRY["2x2"],
    label: "Air Filter",
    inspectable: true,
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new GeneratorBehavior({
        processingTicks: 4,
        output: ITEM_TYPE_OXYGEN,
        secondaryOutput: {itemType: ITEM_TYPE_WATER, processingTicks: 40},
    }),
});

export const MACHINE_TYPES = [
    GreenhouseType,
    BlenderType,
    SpawningPoolType,
    TormentChamberType,
    BrewType,
    BakeType,
    BlastFurnaceType,
    FormingMachineType,
    DelicateAssemblyType,
    FillType,
    AirFilterType,
];
