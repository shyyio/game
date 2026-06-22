import {
    Direction,
    Mod,
    ObjectDefinition,
    PortDefinition,
    PortTransferOp,
    TickOp,
    TickPhase,
    CHUNK_KEY_SQL,
} from "@/sdk/common.js";

export const GAME_OBJECT_TYPE_SPLITTER = 4;

class SplitterPortTransferOp extends PortTransferOp {
    constructor(name, inputPort, outputPort, priority="0", onTransfer) {
        super(name, "Splitter", inputPort, outputPort, priority, onTransfer);
    }
}

// noinspection SqlWithoutWhere
export class SplitterMod extends Mod {

    get schema() {
        return `
            CREATE TABLE Splitter
            (
                id         INTEGER PRIMARY KEY,

                x          INT NOT NULL,
                y          INT NOT NULL,
                direction  INT NOT NULL,
                chunk      TEXT GENERATED ALWAYS AS (${CHUNK_KEY_SQL}) VIRTUAL,

                in_port_a  INT REFERENCES Port,
                in_port_b  INT REFERENCES Port,

                out_port_a INT REFERENCES Port,
                out_port_b INT REFERENCES Port,
                
                int_port_a INT REFERENCES Port,
                int_port_b INT REFERENCES Port,

                state      INT NOT NULL DEFAULT (0)
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
                    new PortDefinition("int_port_a"),
                    new PortDefinition("int_port_b"),
                ],
                {x: 1, y: 0},
                {
                    [TickPhase.SUBMIT_INTENTS]: [
                        // Insert intent in_A -> int_A
                        // Insert intent in_B -> int_B
                        new SplitterPortTransferOp("SplitterIntent_in_a_a", "in_port_a", "int_port_a"),
                        new SplitterPortTransferOp("SplitterIntent_in_b_b", "in_port_b", "int_port_b"),

                        // Insert intent int_A -> out_A (prio=state)
                        // Insert intent int_B -> out_B (prio=state)
                        new SplitterPortTransferOp("SplitterIntent_int_a_a", "int_port_a", "out_port_a", "CASE WHEN state=1 THEN 1 ELSE 0 END"),
                        new SplitterPortTransferOp("SplitterIntent_int_b_b", "int_port_b", "out_port_b", "CASE WHEN state=1 THEN 1 ELSE 0 END"),

                        // Insert intent int_A -> out_B (prio=!state)
                        // Insert intent int_B -> out_A (prio=!state)
                        new SplitterPortTransferOp("SplitterIntent_int_a_b", "int_port_a", "out_port_b", "CASE WHEN state=0 THEN 1 ELSE 0 END"),
                        new SplitterPortTransferOp("SplitterIntent_int_b_a", "int_port_b", "out_port_a", "CASE WHEN state=0 THEN 1 ELSE 0 END"),
                    ],
                    [TickPhase.POST_RESOLVE]: [
                        new TickOp(
                            "Splitter.UpdateState1",
                            `UPDATE Splitter
                                SET state=0
                                WHERE state=1 AND EXISTS(
                                    SELECT 1 
                                    FROM PortTransfer
                                    WHERE (source=int_port_a AND destination=out_port_a)
                                       OR (source=int_port_b AND destination=out_port_b)
                                )`
                        ),
                        new TickOp(
                            "Splitter.UpdateState2",
                            `UPDATE Splitter
                                SET state=1
                                WHERE state=0 AND EXISTS(
                                    SELECT 1 
                                    FROM PortTransfer
                                    WHERE (source=int_port_a AND destination=out_port_b)
                                       OR (source=int_port_b AND destination=out_port_a)
                                )`
                        )
                    ]
                }
            ),
        };
    }

    get tempSchema() {
        return "";
    }

    get triggers() {
        return "";
    }
}
