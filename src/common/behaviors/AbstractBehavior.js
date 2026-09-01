/**
 * A component+system bundle giving a placeable object type its sim behavior. PlacedObjects owns the
 * generic entity lifecycle (spawn/despawn/chunk-sync/inspect); a behavior supplies the type-specific
 * pieces: its components and systems ({@link install}, once per behavior class per engine — never
 * read instance config there) and the per-entity hooks. One behavior instance belongs to exactly one
 * ObjectType; systems read per-entity config through `engine.placed.behaviorFor(typeId)`.
 */
export class AbstractBehavior {

    constructor() {
        /**
         * @type {ObjectType|null}
         */
        this.type = null;
        // Worker interface, read by WorkerNetworks: a positive workerSupply makes the type a source, a
        // positive workerCost a consumer.
        this.workerSupply = 0;
        this.workerCost = 0;
    }

    /**
     * Called by the owning ObjectType's constructor.
     * @param {ObjectType} type
     * @returns {void}
     */
    _attachType(type) {
        if (this.type !== null && this.type !== type) {
            throw new Error(`Behavior already attached to "${this.type.name}"; construct one instance per ObjectType`);
        }
        this.type = type;
    }

    /**
     * Defines this behavior class's components and registers its systems.
     * @param {GameEngine} engine
     * @returns {void}
     */
    install(engine) {

    }

    /**
     * Whether `message` may spawn an entity (e.g. a required resource is present).
     * @param {GameEngine} engine
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {boolean}
     */
    canSpawn(engine, type, message) {
        return true;
    }

    /**
     * Wires the freshly spawned entity: attaches behavior components, resolves ports, registers
     * rendered ports. The insert event's port ids come from {@link syncData}.
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    onSpawn(engine, eid, type, message) {

    }

    /**
     * Releases the entity's behavior state (rendered ports, derived indexes) before it is destroyed.
     * @param {GameEngine} engine
     * @param {number} eid
     * @returns {void}
     */
    onDespawn(engine, eid) {

    }

    /**
     * The behavior payload of the entity's chunk-sync event.
     * @param {GameEngine} engine
     * @param {number} eid
     * @returns {{portIds:number[], lastOutput:number|null}}
     */
    syncData(engine, eid) {
        return {portIds: [], lastOutput: null};
    }

    /**
     * The entity's current inspect snapshot.
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {number} objectId
     * @returns {InspectHeartbeatEvent|null}
     */
    inspect(engine, eid, objectId) {
        return null;
    }

    /**
     * Re-registers the entity's rendered ports after a load repopulates the world.
     * @param {GameEngine} engine
     * @param {number} eid
     * @returns {void}
     */
    resyncRenderedPorts(engine, eid) {

    }

    /**
     * Applies the worker allocation to one entity: `granted` workers of its workerCost (0 = none).
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {number} granted
     * @returns {void}
     */
    setWorkers(engine, eid, granted) {

    }

    /**
     * Rebuilds class-level derived indexes after a load; called once per behavior class.
     * @param {GameEngine} engine
     * @returns {void}
     */
    onRebuild(engine) {

    }

    /**
     * The entity's value for a logic key (LOGIC_KEY_*), or null when it does not expose it.
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {number} key
     * @returns {number|null}
     */
    logicRead(engine, eid, key) {
        return null;
    }

    /**
     * Applies a logic write to the entity; false when the key is not writable.
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {number} key
     * @param {number} value
     * @returns {boolean}
     */
    logicWrite(engine, eid, key, value) {
        return false;
    }

    /**
     * The entity's stored stock, summed into network "stored" totals; null when it stores nothing.
     * @param {GameEngine} engine
     * @param {number} eid
     * @returns {{itemType: number, amount: number}|null}
     */
    logicStored(engine, eid) {
        return null;
    }

    /**
     * The logic keys logicRead answers for this type.
     * @returns {number[]}
     */
    logicReadKeys() {
        return [];
    }

    /**
     * The logic keys logicWrite accepts for this type.
     * @returns {number[]}
     */
    logicWriteKeys() {
        return [];
    }
}
