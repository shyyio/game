import {BeltBend, BeltType, Direction, EventType, GameObject, MAX_UNDERGROUND_LENGTH,} from "@/backend/constants.js";
import * as _ from "underscore";
import {CHUNK_SIZE, snapToChunk, TILE_SIZE} from "@/constants.js";
import {getChunk} from "@/util.js";
import {activateWASDPan} from "@/viewport.js";
import {RS} from "@/backend/ruleset.js";

export class Belt {

    /**
     * @param id {BigInt}
     * @param x {Number}
     * @param y {Number}
     * @param direction {Direction}
     * @param bend {BeltBend}
     * @param type {BeltType}
     */
    constructor(id, x, y, direction, bend, type) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.parentX = x;
        this.parentY = y;
        this.direction = direction;
        this.bend = bend;
        this.type = type
    }

    /**
     * @param e {BeltUpdateEvent}
     */
    update(e) {
        this.bend = Belt.getBend(
            this.direction,
            this.x,
            this.y,
            e.parentX,
            e.parentY
        );
    }

    /**
     * @param direction {Direction}
     * @param x
     * @param y
     * @param parentX
     * @param parentY
     * @returns {BeltBend}
     */
    static getBend(direction, x, y, parentX, parentY) {

        if (parentX === null) {
            return BeltBend.STRAIGHT;
        }

        if (direction === Direction.UP && parentX > x) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.UP && parentX < x) {
            return BeltBend.LEFT;
        } else if (direction === Direction.DOWN && parentX > x) {
            return BeltBend.LEFT;
        } else if (direction === Direction.DOWN && parentX < x) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.LEFT && parentY < y) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.LEFT && parentY > y) {
            return BeltBend.LEFT;
        } else if (direction === Direction.RIGHT && parentY < y) {
            return BeltBend.LEFT;
        } else if (direction === Direction.RIGHT && parentY > y) {
            return BeltBend.RIGHT;
        }

        return BeltBend.STRAIGHT;
    }

    get inputX() {
        if (this.direction === Direction.UP) {
            if (this.bend === BeltBend.LEFT) {
                return this.x - 1;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.x + 1;
            }
            return this.x;
        } else if (this.direction === Direction.RIGHT) {
            if (this.bend === BeltBend.LEFT) {
                return this.x;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.x;
            }
            return this.x - 1;
        } else if (this.direction === Direction.DOWN) {
            if (this.bend === BeltBend.LEFT) {
                return this.x + 1;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.x - 1;
            }
            return this.x;
        } else {
            if (this.bend === BeltBend.LEFT) {
                return this.x;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.x;
            }
            return this.x + 1;
        }
    }

    get inputY() {
        if (this.direction === Direction.UP) {
            if (this.bend === BeltBend.LEFT) {
                return this.y;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.y;
            }
            return this.y + 1;
        } else if (this.direction === Direction.RIGHT) {
            if (this.bend === BeltBend.LEFT) {
                return this.y - 1;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.y + 1;
            }
            return this.y;
        } else if (this.direction === Direction.DOWN) {
            if (this.bend === BeltBend.LEFT) {
                return this.y;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.y;
            }
            return this.y - 1;
        } else {
            if (this.bend === BeltBend.LEFT) {
                return this.y + 1;
            } else if (this.bend === BeltBend.RIGHT) {
                return this.y - 1;
            }
            return this.y;
        }
    }
}

class BeltPathItem {

    /**
     * @param pathId {BigInt}
     * @param id {BigInt}
     * @param type {ItemType}
     * @param length {Number}
     * @param flag {ItemFlag}
     */
    constructor(pathId, id, type, length, flag) {
        this.pathId = pathId;
        this.id = id;
        this.type = type;
        this.length = length;
        this.flag = flag;
    }
}

class BeltPath {

    /**
     * @param parts {BigInt[]}
     */
    constructor(parts) {
        this.id = parts[parts.length-1];
        this.parts = parts;

        this.headGap = this.parts.length;
        this.outputItem = null; // TODO: should the client be aware of output item?

        /**
         * @type {BeltPathItem[]}
         */
        this.items = [];
    }

    /**
     * @param e {BeltPathUpdateEvent}
     */
    update(e) {
        this.headGap = e.headGap;
        this.outputItem = e.outputItem;
    }

    /**
     * @param id {BigInt}
     */
    deleteItem(id) {
        if (!this.items.find(i => i.id === id)) {
            return;
        }

        this.items.splice(
            this.items.findIndex(i => i.id === id),
            1
        );
    }

    /**
     * @param id {BigInt}
     * @param length {Number}
     */
    updateItem(id, length) {
        this.items.find(i => i.id === id).length = length;
    }

    /**
     * @param item {BeltPathItem}
     */
    addItem(item) {
        this.items.push(item);
    }
}

class ObjectInfo {
    /**
     * @param id {BigInt}
     * @param x {number}
     * @param y {number}
     * @param direction {Direction}
     */
    constructor(id, x, y, direction) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.direction = direction;
    }
}

class ClientState {

    constructor() {

        /**
         * @type {{BigInt: Belt}}
         */
        this.belts = {};

        /**
         * @type {{BigInt: BeltPath}}
         */
        this.paths = {};

        /**
         * @type {{BigInt: BeltPathItem}}
         */
        this.items = {};

        /**
         * @type {Object.<GameObject, Object<BigInt, ObjectInfo>>}
         *
         */
        this.objects = {};
        Object.keys(RS.definitions).forEach(name => this.objects[name] = {});

        /**
         * @type {ClientRenderer}
         */
        this.renderer = null;

        /**
         * @type {Viewport}
         */
        this.viewport = null;

        this.loadedChunks = new Set();
    }

    /**
     * @param app {Application}
     * @param backend {GameBackend}
     * @param viewport {Viewport}
     */
    registerEventListeners(app, backend, viewport) {

        backend.on(EventType.BELT_INSERT, e => {
            const belt = new Belt(e.id, e.x, e.y, e.direction,
                Belt.getBend(e.direction, e.x, e.y, e.parentX, e.parentY),
                e.type
            );

            this.belts[e.id] = belt;

            this.renderer.drawBelt(belt);
        });

        backend.on(EventType.BELT_UPDATE, e => {

            this.belts[e.id].update(e);

            this.renderer.removeBelt(e.id);
            this.renderer.drawBelt(this.belts[e.id]);
        });

        backend.on(EventType.BELT_DELETE, e => {
            this.renderer.removeBelt(e.id);
            delete this.belts[e.id];
        });

        const drawBeltPathDebug = _.debounce(
            () => this.renderer.drawBeltPathDebug(this.paths),
            10
        );

        backend.on(EventType.BELT_PATH_RECALCULATE, e => {
            const path = new BeltPath(e.parts);

            delete this.paths[path.id];
            this.paths[path.id] = path;

            drawBeltPathDebug();
        });

        backend.on(EventType.BELT_PATH_DELETE, e => {
            delete this.paths[e.id];
        });

        backend.on(EventType.BELT_PATH_UPDATE, e => {
            this.paths[e.id].update(e);
        });

        backend.on(EventType.BELT_PATH_ITEM_INSERT, e => {
            const item = new BeltPathItem(e.pathId, e.id, e.type, e.length, e.flag);
            this.items[e.id] = item;
            this.paths[item.pathId].addItem(item);
            this.renderer.drawBeltPathItems(this.paths[item.pathId]);
        });

        backend.on(EventType.BELT_PATH_ITEM_UPDATE, e => {
            const path = this.items[e.id].pathId;
            this.paths[path].updateItem(e.id, e.length);
            this.renderer.drawBeltPathItems(this.paths[path]);
        });

        backend.on(EventType.BELT_PATH_ITEM_DELETE, e => {
            delete this.items[e.id];
            this.renderer.removeItem(e.id);

            Object.values(this.paths).forEach(path => {
                path.deleteItem(e.id)
                this.renderer.drawBeltPathItems(path);
            });
        });

        backend.on(EventType.OBJECT_INSERT, e => {
            const info = new ObjectInfo(e.id, e.x, e.y, e.direction);
            this.objects[e.name][e.id] = info;
            this.renderer.drawObject(e.name, info);
        });

        backend.on(EventType.OBJECT_DELETE, e => {
            this.renderer.removeObject(e.name, e.id);
            delete this.objects[e.name][e.id];
        });

        // Viewport envents
        this.viewport = viewport;

        viewport.on("zoomed", () => {
            this.loadChunks(this.viewportX1, this.viewportY1, this.viewportX2, this.viewportY2);
        });
        viewport.on("moved", () => {
            this.loadChunks(this.viewportX1, this.viewportY1, this.viewportX2, this.viewportY2);
        });

        activateWASDPan(app, viewport, () => {
            this.loadChunks(this.viewportX1, this.viewportY1, this.viewportX2, this.viewportY2);
        });
        this.loadChunks(this.viewportX1, this.viewportY1, this.viewportX2, this.viewportY2);
    }

    get viewportX1() {
        return this.viewport.left / TILE_SIZE;
    }

    get viewportY1() {
        return this.viewport.top / TILE_SIZE;
    }

    get viewportX2() {
        return this.viewport.right / TILE_SIZE;
    }

    get viewportY2() {
        return this.viewport.bottom / TILE_SIZE;
    }

    /**
     * @param x {Number}
     * @param y {Number}
     * @returns {Belt}
     */
    getBelt(x, y) {
        return Object.values(this.belts)
            // Undergrounds last
            .sort((a, b) => a.type === BeltType.UNDERGROUND ? 1 : -1)
            .find(
            belt => belt.x === x && belt.y === y
        );
    }

    getBeltParent(x, y, direction) {

        const candidates = Object.values(this.belts).filter(belt  => {
            if (direction === Direction.UP) {
                return (belt.x === x && belt.y === y+1 && belt.direction === Direction.UP)
                    || (belt.x === x-1 && belt.y === y && belt.direction === Direction.RIGHT)
                    || (belt.x === x+1 && belt.y === y && belt.direction === Direction.LEFT);
            } else if (direction === Direction.RIGHT) {
                return (belt.x === x-1 && belt.y === y && belt.direction === Direction.RIGHT)
                    || (belt.x === x && belt.y === y+1 && belt.direction === Direction.UP)
                    || (belt.x === x && belt.y === y-1 && belt.direction === Direction.DOWN);
            } else if (direction === Direction.DOWN) {
                return (belt.x === x && belt.y === y-1 && belt.direction === Direction.DOWN)
                    || (belt.x === x-1 && belt.y === y && belt.direction === Direction.RIGHT)
                    || (belt.x === x+1 && belt.y === y && belt.direction === Direction.LEFT);
            } else {
                return (belt.x === x-1 && belt.y === y && belt.direction === Direction.LEFT)
                    || (belt.x === x && belt.y === y+1 && belt.direction === Direction.UP)
                    || (belt.x === x && belt.y === y-1 && belt.direction === Direction.DOWN);
            }
        });

        if (candidates.length === 0) {
            return null
        }

        return candidates.sort((a, b) => Number(b.id - a.id))[0];
    }

    /**
     * @param x {Number}
     * @param y {Number}
     * @param direction {Direction}
     * @param type {BeltType}
     * @returns {{parent: Belt, child: Belt}}
     */
    findRampParent(x, y, direction, type) {
        if (type === BeltType.NORMAL) {
            return {parent: null, child: null};
        }

        const dx = type === BeltType.RAMP_UP ? -Direction.dx(direction) : Direction.dx(direction);
        const dy = type === BeltType.RAMP_UP ? -Direction.dy(direction) : Direction.dy(direction);

        const parentType = type === BeltType.RAMP_UP ? BeltType.RAMP_DOWN : BeltType.RAMP_UP;
        const childType = type === BeltType.RAMP_UP ? BeltType.RAMP_UP : BeltType.RAMP_DOWN;

        let foundParent = null;
        for (let i = 1; i < MAX_UNDERGROUND_LENGTH + 2; i++) {
            x += dx;
            y += dy;

            const parent = this.getBelt(x, y);

            if (parent && parent.type === childType) {
                return {parent: null, child: null};
            }

            if (parent && parent.type === parentType) {
                foundParent = parent;
                break
            }
        }

        if (!foundParent) {
            return {parent: null, child: null};
        }

        // Try to find the parent's existing child
        let existingChild = null;
        for (let i = 1; i < MAX_UNDERGROUND_LENGTH + 2; i++) {
            x -= dx;
            y -= dy;

            const child = this.getBelt(x, y);

            if (child && child.type === parentType) {
                break;
            }

            if (child && child.type === childType) {
                // Child already exists
                existingChild = child;
            }
        }

        return {parent: foundParent, child: existingChild};
    }


    /**
     * @param x1 {Number}
     * @param y1 {Number}
     * @param x2 {Number}
     * @param y2 {Number}
     * @returns {Set<string>}
     */
    static getChunksToLoad(x1, y1, x2, y2) {

        let chunks = new Set();

        for (let x = snapToChunk(x1) - CHUNK_SIZE; x <= snapToChunk(x2); x += CHUNK_SIZE) {
            for (let y = snapToChunk(y1) - CHUNK_SIZE; y <= snapToChunk(y2); y += CHUNK_SIZE) {
                chunks.add(getChunk(x, y));
            }
        }

        return chunks;
    }

    /**
     * @param chunk {string}
     */
    loadChunk(chunk) {
        this.loadedChunks.add(chunk)

        this.renderer.drawChunkGrid(chunk);
    }

    /**
     * @param chunk {string}
     */
    unloadChunk(chunk) {
        this.loadedChunks.delete(chunk);

        this.renderer.removeChunkGrid(chunk);
    }

    /**
     * @param x1 {Number}
     * @param y1 {Number}
     * @param x2 {Number}
     * @param y2 {Number}
     */
    loadChunks(x1, y1, x2, y2) {

        const chunksToLoad = ClientState.getChunksToLoad(x1, y1, x2, y2);

        this.loadedChunks.forEach(chunk => {
            if (!chunksToLoad.has(chunk)) {
                this.unloadChunk(chunk);
            }
        });

        chunksToLoad.forEach(chunk => {
            if (!this.loadedChunks.has(chunk)) {
                this.loadChunk(chunk);
            }
        });

        this.renderer.sortChunkGrid();
    }

}

export default new ClientState();