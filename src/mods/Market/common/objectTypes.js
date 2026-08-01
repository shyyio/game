import {ObjectType, PortDefinition, PlacementRule, MenuVerb, MiniMenuEntry, DeleteVerb, Direction} from "@/sdk/common.js";
import {TradingTerminalBehavior} from "../sim/TradingTerminalBehavior.js";

const CONFIGURE_RANK = 30;
const DELETE_RANK = 10;

/**
 * Opens the client-side pixi config panel for a placed terminal; never sends a message itself —
 * submitting the panel is what sends ConfigureTradingTerminalMessage.
 */
export class ConfigureVerb extends MenuVerb {

    /**
     * @param {ObjectType} type
     * @param {CacheEntry} record
     * @param {AbstractSession} session
     * @param {Client} client
     * @returns {MiniMenuEntry}
     */
    entry(type, record, session, client) {
        return new MiniMenuEntry(
            `Configure ${type.label}`,
            this.rank,
            () => client.cache.writer("market").openConfig(record.id),
        );
    }
}

export const TradingTerminalType = new ObjectType({
    name: "TradingTerminal",
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    // Placeholder sprite; mod adds no new art.
    textureName: "demo-machine/0",
    label: "Trading Terminal",
    placement: new PlacementRule({replaceSameKind: true}),
    menuVerbs: [
        new ConfigureVerb(CONFIGURE_RANK),
        new DeleteVerb(DELETE_RANK),
    ],
    behavior: new TradingTerminalBehavior(),
});
