import {Mod, ObjectDefinition, OpCode, PortDefinition, TickOp, TickPhase} from "@/backend/core.js";
import {Direction, ItemFlag, ItemType} from "@/backend/constants.js";
import {Chunk} from "@/backend/schema.js";

// noinspection SqlWithoutWhere
export class BeltMod extends Mod {

    get schema() {
        return `
            CREATE TABLE BeltPath (
                id INTEGER PRIMARY KEY REFERENCES Belt(id) ON DELETE CASCADE,
                tail INT UNIQUE REFERENCES Belt(id),
                length INT,

                head_gap INT
                    CHECK (head_gap >= 0 AND head_gap <= length),

                in_port INT REFERENCES Port(id) ON DELETE SET NULL
                    CHECK (in_port IS NULL OR in_port != out_port),

                out_port INT REFERENCES Port(id) ON DELETE SET NULL
                    CHECK (out_port IS NULL OR in_port != out_port),

                next_gap_id INT,
                next_item_id INT
            );
            CREATE INDEX BeltPath_ports ON BeltPath(in_port, out_port);

            CREATE TABLE Belt (
                id INTEGER PRIMARY KEY,
                parent INT UNIQUE REFERENCES Belt(id),

                path INT REFERENCES BeltPath,
                path_index INT,

                x INT NOT NULL,
                y INT NOT NULL,
                type INT NOT NULL
                    CHECK (type >= 0),

                chunk TEXT GENERATED ALWAYS AS (${Chunk}) VIRTUAL,

                direction INT NOT NULL
            );

            CREATE UNIQUE INDEX Belt_x_y_direction ON Belt(x, y, direction, type);
            CREATE INDEX Belt_path ON Belt(path, path_index);

            CREATE TABLE BeltPathItem (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                path INT NOT NULL REFERENCES BeltPath ON DELETE CASCADE,
                length INT NOT NULL CHECK (length >= 0),

                type INT NOT NULL CHECK (type >= 0)
            );

            CREATE INDEX BeltPathItem_path_id_type ON BeltPathItem(path, id, type);
            CREATE INDEX BeltPathItem_length ON BeltPathItem (length);
        `;
    }

    get definitions() {
        return {

            Belt: new ObjectDefinition(
                [
                    new PortDefinition("virtual_left", {x: 0, y: 0, direction: Direction.RIGHT}),
                    new PortDefinition("virtual_down", {x: 0, y: 0, direction: Direction.UP}),
                    new PortDefinition("virtual_right", {x: 0, y: 0, direction: Direction.LEFT}),
                ],
                [
                    new PortDefinition("virtual_up", {x: 0, y: -1, direction: Direction.UP}),
                ],
                [],
                {x: 0, y: 0},
                {
                    [TickPhase.SUBMIT_INTENTS]: [

                        // Case 1: Output is full, or next item is a gap
                        new TickOp(
                            "TickBeltPathCase1",
                            `UPDATE BeltPathItem
                            SET length = length - 1
                            WHERE id IN (
                                SELECT p.next_gap_id
                                FROM BeltPath p
                                         INNER JOIN Port outPort ON outPort.id = p.out_port
                                WHERE (
                                          p.next_gap_id IS NOT NULL
                                              AND
                                          (
                                              -- Next item is a gap
                                              p.next_gap_id < p.next_item_id
                                                  OR
                                              p.next_item_id IS NULL
                                                  OR
                                                  -- Output is full
                                              outPort.item IS NOT NULL
                                              -- TODO: Check if child belt could accept the item? Not recursive
                                              )
                                          )
                                );`
                        ),
                        // Case 2: output is not full and next item is not a gap
                        //  - pop item into output port
                        new TickOp(
                            "TickBeltPathCase2",
                            `INSERT INTO BeltPathOutputItem (path, item_id, item_type, port)
                            SELECT BeltPath.id, item.id, item.type, outPort.id
                            FROM BeltPath
                                     INNER JOIN BeltPathItem item ON item.id = next_item_id
                                     INNER JOIN Port outPort ON outPort.id = out_port
                            WHERE
                              -- Next item is an item
                                (
                                    next_gap_id IS NULL
                                        OR
                                    next_item_id < next_gap_id
                                    )
                              -- There is space in the output
                              AND outPort.item IS NULL;`
                        ),

                        // If there is a gap anywhere in the path (including a 0-length gap),
                        // or if an item was consumed (output_item_id !=NULL)
                        // this means that the head_gap needs to be incremented 
                        // (UNLESS an item was inserted this tick, in which case, head_gap will be reset to 0
                        // in TickBeltPathCleanup5)
                        new TickOp(
                            "TickBeltPathRecalculateHeadGap",
                            `UPDATE BeltPath
                            SET head_gap = head_gap + 1
                            WHERE (
                                next_gap_id IS NOT NULL
                                OR id IN (SELECT path FROM BeltPathOutputItem)
                            );`
                        ),

                        // new TickOp(
                        //     "TickBeltPathIntent",
                        //     `INSERT INTO PortTransferIntent
                        //          (source, destination, priority, destination_is_empty, managed)
                        //     SELECT
                        //         in_port source,
                        //         out_port destination,
                        //         1 priority,
                        //         (head_gap > 0) destination_is_empty,
                        //         TRUE managed
                        //     FROM BeltPath
                        //        INNER JOIN Port src ON src.id = BeltPath.in_port
                        //     WHERE src.item IS NOT NULL;`
                        // ),

                        new TickOp(
                            "TickBeltFillOutPort",
                            `UPDATE Port
                            SET item=item.item_type
                            FROM BeltPathOutputItem item
                            WHERE Port.id = item.port;`
                        ),

                        new TickOp(
                            "TickBeltPathInsertItem",
                            `INSERT INTO BeltPathItem (path, type, length)
                                -- If the head gap is more than 1 spaces, add a gap item first
                                SELECT BeltPath.id,
                                       0,
                                       head_gap - 1
                                FROM BeltPath
                                    INNER JOIN Port inPort ON inPort.id = in_port
                                WHERE head_gap > 1
                                  AND inPort.item IS NOT NULL
                                UNION ALL
                                -- item
                                SELECT BeltPath.id,
                                       inPort.item,
                                       1
                                FROM BeltPath
                                    INNER JOIN Port inPort ON inPort.id = in_port
                                WHERE head_gap > 0
                                  AND inPort.item IS NOT NULL;`
                        ),
                        new TickOp(
                            "TickBeltPathCleanup1",
                            `DELETE
                             FROM BeltPathItem
                             WHERE length = 0 OR id IN (SELECT item_id FROM BeltPathOutputItem);`
                        ),

                        new TickOp(
                            "TickBeltPathCleanup2",
                            `DELETE FROM BeltPathOutputItem;`
                        ),
                        new TickOp(
                            "TickBeltPathCleanup3",
                            `INSERT INTO BeltPathInputItem (path, port)
                             SELECT BeltPath.id, Port.id
                             FROM BeltPath
                                INNER JOIN Port ON Port.id = in_port
                             WHERE BeltPath.head_gap > 0
                               AND item IS NOT NULL;`
                        ),
                        new TickOp(
                            "TickBeltPathCleanup4",
                            `UPDATE Port
                             SET item = NULL
                             FROM BeltPathInputItem
                             WHERE Port.id = BeltPathInputItem.port;`
                        ),

                        new TickOp(
                            "TickBeltPathCleanup5",
                            `UPDATE BeltPath
                                SET head_gap = 0
                                FROM BeltPathInputItem
                                WHERE BeltPath.id = BeltPathInputItem.path;`
                        ),
                        new TickOp(
                            "TickBeltPathCleanup6",
                            `DELETE FROM BeltPathInputItem;`
                        ),
                    ],
                    [TickPhase.COMMIT_TRANSFERS]: [
                    ]
                },
            ),
        };
    }

    get tempSchema() {
        return `
            CREATE TEMPORARY TABLE StashedItem (
                id INTEGER PRIMARY KEY,
                belt INT,
                type INT
            );

            CREATE TEMPORARY TABLE StashedOutputItem (
                id INTEGER PRIMARY KEY,
                belt INT,
                type INT
            );

            CREATE TEMPORARY TABLE BeltPathInputItem (
                path INT,
                port INT
            );

            CREATE TEMPORARY TABLE BeltPathOutputItem (
                path INTEGER PRIMARY KEY,
                port INT NOT NULL,
                item_id INT NOT NULL,
                item_type INT NOT NULL
            );
        `;
    }

    get triggers() {
        return `
        CREATE TEMP TRIGGER Belt_parent_update AFTER UPDATE OF parent ON main.Belt
        BEGIN
            SELECT console_log('Belt_parent_update');
            
            WITH child AS (
                VALUES (NEW.id, NEW.parent)
            )
            SELECT on_belt_update(CAST(child.id AS TEXT), parent.x, parent.y)
                FROM child 
                LEFT JOIN Belt parent ON child.parent = parent.id;
        END;
        
        CREATE TEMP TRIGGER Belt_insert AFTER INSERT ON main.Belt
        BEGIN
            SELECT console_log('Belt_insert');
            
            WITH child AS (
                VALUES (NEW.id, NEW.x, NEW.y, NEW.direction, NEW.type, NEW.parent)
            )
            SELECT on_belt_insert(CAST(child.id AS TEXT), child.x, child.y, child.direction, child.type, parent.x, parent.y)
                FROM child 
                LEFT JOIN Belt parent ON child.parent = parent.id;
        END;
        
        CREATE TEMP TRIGGER Belt_delete BEFORE DELETE ON main.Belt
        BEGIN
            SELECT console_log('Belt_delete');
            
            -- If tail is deleted, invalidate path and remove output_item
            UPDATE Port SET item=NULL WHERE id=(SELECT out_port FROM BeltPath WHERE id=OLD.path AND tail=OLD.id);
            UPDATE BeltPath SET tail=NULL WHERE id=OLD.path AND tail=OLD.id;
            
            -- If head is deleted, invalidate the path
            UPDATE Belt SET path=NULL, path_index=NULL WHERE OLD.id=OLD.path AND Belt.path=OLD.path;
            
            SELECT on_belt_delete(CAST(OLD.id AS TEXT));
        END;
        
        CREATE TEMP TRIGGER BeltPath_delete AFTER DELETE ON main.BeltPath
        BEGIN
            SELECT console_log('BeltPath_delete');
            
            SELECT on_belt_path_delete(CAST(OLD.id AS TEXT));
        END;
        
        CREATE TEMP TRIGGER BeltPathItem_insert AFTER INSERT ON main.BeltPathItem
        BEGIN
            SELECT console_log('BeltPathItem_insert');
            
            UPDATE BeltPath SET
                next_gap_id = NEW.id
            WHERE
                NEW.type = ${ItemType.GAP}
                AND id=NEW.path
                AND next_gap_id IS NULL;
                
            UPDATE BeltPath SET
                next_item_id = NEW.id
            WHERE
                NEW.type != ${ItemType.GAP}
                AND id=NEW.path
                AND next_item_id IS NULL;
               
            SELECT on_belt_path_item_insert(CAST(NEW.path AS TEXT), CAST(NEW.id AS TEXT), NEW.type, NEW.length,
                CASE WHEN EXISTS (SELECT id FROM StashedItem) THEN ${ItemFlag.STASHED} ELSE 0 END
            );
        END;
        
        CREATE TEMP TRIGGER BeltPathItem_delete AFTER DELETE ON main.BeltPathItem
        BEGIN
            SELECT console_log('BeltPathItem_delete');
        
            UPDATE BeltPath SET
                next_gap_id = (SELECT MIN(id) FROM BeltPathItem WHERE path=OLD.path AND type=${ItemType.GAP}) 
            WHERE
                OLD.type = ${ItemType.GAP}
                AND id = OLD.path AND next_gap_id = OLD.id;
                
            UPDATE BeltPath SET
                next_item_id = (SELECT MIN(id) FROM BeltPathItem WHERE path=OLD.path AND type!=${ItemType.GAP}) 
            WHERE
                OLD.type != ${ItemType.GAP}
                AND id = OLD.path AND next_item_id = OLD.id;
                
            SELECT on_belt_path_item_delete(CAST(OLD.id AS TEXT));
        END;
        
        CREATE TEMP TRIGGER BeltPathItem_update AFTER UPDATE OF length ON main.BeltPathItem
        BEGIN
            SELECT console_log('BeltPathItem_update');
            
            SELECT on_belt_path_item_update(CAST(NEW.id AS TEXT), NEW.length) 
            WHERE NEW.length > 0; -- if length=0, it will be deleted anyway
        END;
        `;
    }
}
