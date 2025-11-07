import {Direction} from "@/backend/constants.js";
import {Mod, ObjectDefinition, OpCode, PortDefinition, TickOp, TickPhase, TransferDefinition} from "@/backend/core.js";
import {Chunk} from "@/backend/schema.js";

export class SplitterMod extends Mod {

    get schema() {
        return `
            CREATE TABLE Splitter
            (
                id         INTEGER PRIMARY KEY,

                x          INT NOT NULL,
                y          INT NOT NULL,
                direction  INT NOT NULL,
                chunk      TEXT GENERATED ALWAYS AS (${Chunk}) VIRTUAL,

                in_port_a  INT REFERENCES Port,
                in_port_b  INT REFERENCES Port,

                out_port_a INT REFERENCES Port,
                out_port_b INT REFERENCES Port,

                state      INT NOT NULL DEFAULT (0),
                slot_a     INT,
                slot_b     INT
            );

            CREATE INDEX Splitter_ports ON Splitter (in_port_a, in_port_b, out_port_a, out_port_b);
            CREATE UNIQUE INDEX Splitter_x_y_direction ON Splitter (x, y, direction);
        `;
    }

    get definitions() {
        return {
            Splitter: new ObjectDefinition(
                [
                    new PortDefinition("in_port_a", {x: 0, y: 0, direction: Direction.UP}),
                    new PortDefinition("in_port_b", {x: 1, y: 0, direction: Direction.UP}),
                ],
                [
                    new PortDefinition("out_port_a", {x: 0, y: -1, direction: Direction.UP}),
                    new PortDefinition("out_port_b", {x: 1, y: -1, direction: Direction.UP}),
                ],
                [
                    // TODO: lock slot
                    new TransferDefinition("in_port_a", "slot_a"),
                    new TransferDefinition("in_port_b", "slot_b"),
                ],
                [
                    // Slot A
                    new TransferDefinition(
                        "out_port_a",
                        "slot_a",
                        null,
                        "state=0",
                        `UPDATE Splitter
                         SET state=1
                         WHERE id IN (SELECT id FROM PortTransfer)`,
                        1
                    ),
                    new TransferDefinition(
                        "out_port_b",
                        "slot_a",
                        "INNER JOIN Port outA ON outA.id=out_port_a",
                        "state=0 AND outA.item IS NOT NULL",
                        null,
                        1
                    ),
                    new TransferDefinition(
                        "out_port_b",
                        "slot_a",
                        null,
                        "state=1",
                        `UPDATE Splitter
                         SET state=0
                         WHERE id IN (SELECT id FROM PortTransfer)`,
                        1
                    ),
                    new TransferDefinition(
                        "out_port_a",
                        "slot_a",
                        "INNER JOIN Port outB ON outB.id=out_port_b",
                        "state=1 AND outB.item IS NOT NULL",
                        null,
                        1
                    ),

                    // Slot B
                    new TransferDefinition(
                        "out_port_b",
                        "slot_b",
                        null,
                        "state=0",
                        `UPDATE Splitter
                         SET state=1
                         WHERE id IN (SELECT id FROM PortTransfer)`,
                        1
                    ),
                    new TransferDefinition(
                        "out_port_a",
                        "slot_b",
                        "INNER JOIN Port outB ON outB.id=out_port_b",
                        "state=0 AND outB.item IS NOT NULL",
                        null,
                        1
                    ),
                    new TransferDefinition(
                        "out_port_a",
                        "slot_b",
                        null,
                        "state=1",
                        `UPDATE Splitter
                         SET state=0
                         WHERE id IN (SELECT id FROM PortTransfer)`,
                        1
                    ),
                    new TransferDefinition(
                        "out_port_b",
                        "slot_b",
                        "INNER JOIN Port outA ON outA.id=out_port_a",
                        "state=1 AND outA.item IS NOT NULL",
                        null,
                        1
                    ),
                ],
                [],
                {},
                {x: 1, y: 0},
                {
                    [TickPhase.INPUT]: [
                        new TickOp(OpCode.INPUT_TRANSFER, 0),
                        new TickOp(OpCode.INPUT_TRANSFER, 1),
                    ],
                    [TickPhase.OUTPUT]: [
                        new TickOp(OpCode.OUTPUT_TRANSFER, 0),
                        new TickOp(OpCode.OUTPUT_TRANSFER, 1),
                        new TickOp(OpCode.OUTPUT_TRANSFER, 2),
                        new TickOp(OpCode.OUTPUT_TRANSFER, 3),
                        new TickOp(OpCode.OUTPUT_TRANSFER, 4),
                        new TickOp(OpCode.OUTPUT_TRANSFER, 5),
                        new TickOp(OpCode.OUTPUT_TRANSFER, 6),
                        new TickOp(OpCode.OUTPUT_TRANSFER, 7),
                    ]
                }
            ),
        };
    }

    get tempSchema() {
        return "";
    }
}
