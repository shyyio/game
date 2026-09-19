import {ObjectType, PortDefinition, PlacementRule, Direction} from "@spup/sdk";
import {TradingTerminalBehavior} from "../sim/TradingTerminalBehavior.js";

export const TradingTerminalType = new ObjectType({
    name: "TradingTerminal",
    toolId: 9,
    inputPorts: [new PortDefinition("inputPort", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    // Placeholder sprite; mod adds no new art.
    textureName: "machine/1x1",
    label: "Trading Terminal",
    placement: new PlacementRule({shouldReplaceSameKind: true}),
    // Never sends a message itself; submitting the panel is what sends ConfigureTradingTerminalMessage.
    tapAction: (entry, session, client) => client.cache.writer("market").openConfig(entry.id),
    behavior: new TradingTerminalBehavior(),
});
