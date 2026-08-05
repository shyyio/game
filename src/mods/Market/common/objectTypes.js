import {ObjectType, PortDefinition, PlacementRule, Direction} from "@/sdk/common.js";
import {TradingTerminalBehavior} from "../sim/TradingTerminalBehavior.js";

export const TradingTerminalType = new ObjectType({
    name: "TradingTerminal",
    toolId: 9,
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    // Placeholder sprite; mod adds no new art.
    textureName: "demo-machine/0",
    label: "Trading Terminal",
    placement: new PlacementRule({replaceSameKind: true}),
    // Never sends a message itself; submitting the panel is what sends ConfigureTradingTerminalMessage.
    tapAction: (record, session, client) => client.cache.writer("market").openConfig(record.id),
    behavior: new TradingTerminalBehavior(),
});
