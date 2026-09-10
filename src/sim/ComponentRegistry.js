import {AbstractComponent} from "@/sim/AbstractComponent.js";

/**
 * Every {@link AbstractComponent} a loadout registers, in definition order. The generic serializer
 * walks these, so any state a module keeps in a component round-trips with no bespoke save code.
 */
export class ComponentRegistry {

    /**
     * @param {GameEngine} engine - for the world the entities live in
     */
    constructor(engine) {
        this.engine = engine;

        /**
         * Registered components in definition order.
         * @type {AbstractComponent[]}
         */
        this.components = [];

        /**
         * @type {Map<string, AbstractComponent>}
         * @private
         */
        this._byName = new Map();
    }

    /**
     * Registers a component, binding it to the world when one exists.
     * @template {AbstractComponent} T
     * @param {T} component
     * @returns {T}
     */
    register(component) {
        this.components.push(component);
        this._byName.set(component.name, component);
        if (this.engine.world !== null) {
            component.bind(this.engine.world);
        }
        return component;
    }

    /**
     * @deprecated transitional; registers a bare component
     * @returns {AbstractComponent}
     */
    define(name, fieldSpecs, options) {
        return this.register(new AbstractComponent(name, fieldSpecs, options));
    }

    /**
     * The component registered under `name`; throws on an unknown name.
     * @param {string} name
     * @returns {AbstractComponent}
     */
    get(name) {
        const component = this._byName.get(name);
        if (component === undefined) {
            throw new Error(`Unknown component "${name}"`);
        }
        return component;
    }

    /**
     * The component registered under `name`, or undefined — the tolerant twin of {@link get}, for
     * the save checks that report a drifted component instead of throwing on it.
     * @param {string} name
     * @returns {AbstractComponent|undefined}
     */
    find(name) {
        return this._byName.get(name);
    }

    /**
     * Binds every registered component to the current world; the components outlive it, so this runs
     * again for each new one.
     * @returns {void}
     */
    bindAll() {
        for (const component of this.components) {
            component.bind(this.engine.world);
        }
    }

    /**
     * Resets every registered component's columns to their default values.
     * @returns {void}
     */
    clearAll() {
        for (const component of this.components) {
            component.clear();
        }
    }

    /**
     * Removes an entity (and all its components) from the world; a no-op for an already-destroyed eid.
     * @param {number} eid
     * @returns {void}
     */
    destroyEntity(eid) {
        if (this.engine.world.entityExists(eid)) {
            this.engine.world.removeEntity(eid);
        }
    }
}
