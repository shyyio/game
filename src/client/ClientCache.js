import {NotImplementedError} from "@/common/error.js";
import {ListenerList} from "@/common/ListenerList.js";

// Leaf kinds a namespace schema can declare.
export const STATE_KIND_SCALAR = "scalar";
export const STATE_KIND_MAP = "map";
export const STATE_KIND_SET = "set";

/**
 * One declared leaf of the state tree: its kind, its live value, and its subscribers.
 */
class StateEntry {

    /**
     * @param {string} kind
     * @param {*} value
     */
    constructor(kind, value) {
        this.kind = kind;
        this.value = value;
        this.listeners = new ListenerList();
    }
}

/**
 * @param {number|string|null} initial
 * @returns {{kind: string, initial: number|string|null}}
 */
export function schemaScalar(initial) {
    return {kind: STATE_KIND_SCALAR, initial};
}

/**
 * @returns {{kind: string}}
 */
export function schemaMap() {
    return {kind: STATE_KIND_MAP};
}

/**
 * @returns {{kind: string}}
 */
export function schemaSet() {
    return {kind: STATE_KIND_SET};
}

/**
 * A namespace's writer: the only code that writes its keys — from events via onEvent, or its
 * own local write methods.
 * @abstract
 */
export class AbstractCacheWriter {

    /**
     * @param {ClientCache} state
     */
    constructor(state) {
        this._state = state;
    }

    /**
     * Applies one event to the namespace.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        throw new NotImplementedError();
    }
}

/**
 * A namespace's view: derived reads over the tree. Constructed bare; register() binds the tree.
 * @abstract
 */
export class AbstractCacheView {

    constructor() {
        this._state = null;
    }

    /**
     * Hands the view its tree (called by register) and runs the onBind hook.
     * @param {ClientCache} state
     * @returns {void}
     */
    bind(state) {
        this._state = state;
        this.onBind();
    }

    /**
     * Optional hook: the tree is bound; the place to wire subscriptions.
     * @returns {void}
     */
    onBind() {

    }
}

/**
 * The shared client state tree. Each namespace registers three parts: a schema (the plain-data
 * shape), a writer (the only code that writes — from events via onEvent, or via its own local
 * write methods), and an optional view (a class exposing derived reads over the tree). Every
 * event fans out to every writer; every write notifies the path's subscribers; dump() snapshots
 * the whole tree.
 */
export class ClientCache {

    constructor() {
        /**
         * @type {Map<string, StateEntry>} "namespace.key" -> its leaf
         */
        this._entriesByPath = new Map();

        /**
         * @type {Map<string, object>} namespace -> its writer, in registration order
         */
        this._writersByNamespace = new Map();

        /**
         * @type {Map<string, object>} namespace -> its view
         */
        this._viewsByNamespace = new Map();
    }

    /**
     * Declares a namespace: its schema, the writer feeding it, and its view (null for a
     * namespace read only by path). Fan-out follows registration order.
     * @param {string} namespace
     * @param {Object.<string, {kind: string, initial: *}>} schema
     * @param {object} writer must expose onEvent(event)
     * @param {object|null} [view]
     * @returns {void}
     */
    register(namespace, schema, writer, view=null) {
        if (this._writersByNamespace.has(namespace)) {
            throw new Error(`Namespace already registered: ${namespace}`);
        }
        if (!(writer instanceof AbstractCacheWriter)) {
            throw new Error(`Writer must extend AbstractCacheWriter: ${namespace}`);
        }
        if (view !== null && !(view instanceof AbstractCacheView)) {
            throw new Error(`View must extend AbstractCacheView: ${namespace}`);
        }
        for (const [key, declared] of Object.entries(schema)) {
            let value;
            if (declared.kind === STATE_KIND_SCALAR) {
                value = declared.initial;
            } else if (declared.kind === STATE_KIND_MAP) {
                value = new Map();
            } else if (declared.kind === STATE_KIND_SET) {
                value = new Set();
            } else {
                throw new Error(`Unknown schema kind for ${namespace}.${key}: ${declared.kind}`);
            }
            this._entriesByPath.set(`${namespace}.${key}`, new StateEntry(declared.kind, value));
        }
        this._writersByNamespace.set(namespace, writer);
        if (view !== null) {
            this._viewsByNamespace.set(namespace, view);
            view.bind(this);
        }
    }

    /**
     * The namespace's view; throws when the namespace is unknown or registered none.
     * @param {string} namespace
     * @returns {object}
     */
    view(namespace) {
        const view = this._viewsByNamespace.get(namespace);
        if (view === undefined) {
            throw new Error(`No view for namespace: ${namespace}`);
        }
        return view;
    }

    /**
     * The namespace's writer, for local (non-event) mutations; throws on an unknown namespace.
     * @param {string} namespace
     * @returns {object}
     */
    writer(namespace) {
        const writer = this._writersByNamespace.get(namespace);
        if (writer === undefined) {
            throw new Error(`No writer for namespace: ${namespace}`);
        }
        return writer;
    }

    /**
     * Fans an event out to every writer.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        for (const writer of this._writersByNamespace.values()) {
            writer.onEvent(event);
        }
    }

    /**
     * Subscribes to a path: scalar listeners get (value), map listeners (id, value) with
     * undefined on delete, set listeners (id, present).
     * @param {string} path
     * @param {Function} listener
     * @returns {function(): void} unsubscribe
     */
    subscribe(path, listener) {
        return this._entry(path).listeners.add(listener);
    }

    /**
     * @param {string} path
     * @returns {number|string|null}
     */
    get(path) {
        return this._entry(path, STATE_KIND_SCALAR).value;
    }

    /**
     * Writes a scalar; an unchanged value notifies nobody.
     * @param {string} path
     * @param {number|string|null} value
     * @returns {void}
     */
    set(path, value) {
        const entry = this._entry(path, STATE_KIND_SCALAR);
        if (Object.is(entry.value, value)) {
            return;
        }
        entry.value = value;
        entry.listeners.notify(value);
    }

    /**
     * @param {string} path
     * @param {number} id
     * @returns {*|undefined}
     */
    mapGet(path, id) {
        return this._entry(path, STATE_KIND_MAP).value.get(id);
    }

    /**
     * Writes one map value; an identical value notifies nobody.
     * @param {string} path
     * @param {number} id
     * @param {*} value
     * @returns {void}
     */
    mapSet(path, id, value) {
        const entry = this._entry(path, STATE_KIND_MAP);
        if (Object.is(entry.value.get(id), value)) {
            return;
        }
        entry.value.set(id, value);
        entry.listeners.notify(id, value);
    }

    /**
     * Deletes one map value, notifying with undefined; an unknown id notifies nobody.
     * @param {string} path
     * @param {number} id
     * @returns {void}
     */
    mapDelete(path, id) {
        const entry = this._entry(path, STATE_KIND_MAP);
        if (!entry.value.delete(id)) {
            return;
        }
        entry.listeners.notify(id, undefined);
    }

    /**
     * @param {string} path
     * @returns {IterableIterator<[number, *]>}
     */
    mapEntries(path) {
        return this._entry(path, STATE_KIND_MAP).value.entries();
    }

    /**
     * Deletes every map value matching the predicate, notifying per id.
     * @param {string} path
     * @param {function(*): boolean} predicate
     * @returns {void}
     */
    mapDeleteWhere(path, predicate) {
        // Snapshot first: the per-delete notifications may re-enter the map.
        const dropped = [];
        for (const [id, value] of this.mapEntries(path)) {
            if (predicate(value)) {
                dropped.push(id);
            }
        }
        for (const id of dropped) {
            this.mapDelete(path, id);
        }
    }

    /**
     * @param {string} path
     * @param {number} id
     * @returns {boolean}
     */
    setHas(path, id) {
        return this._entry(path, STATE_KIND_SET).value.has(id);
    }

    /**
     * @param {string} path
     * @returns {IterableIterator<number>}
     */
    setValues(path) {
        return this._entry(path, STATE_KIND_SET).value.values();
    }

    /**
     * Adds one member, notifying with (id, true); a present member notifies nobody.
     * @param {string} path
     * @param {number} id
     * @returns {void}
     */
    setAdd(path, id) {
        const entry = this._entry(path, STATE_KIND_SET);
        if (entry.value.has(id)) {
            return;
        }
        entry.value.add(id);
        entry.listeners.notify(id, true);
    }

    /**
     * Removes one member, notifying with (id, false); an absent member notifies nobody.
     * @param {string} path
     * @param {number} id
     * @returns {void}
     */
    setDelete(path, id) {
        const entry = this._entry(path, STATE_KIND_SET);
        if (!entry.value.delete(id)) {
            return;
        }
        entry.listeners.notify(id, false);
    }

    /**
     * Replaces a set's members wholesale, notifying each dropped and each new member.
     * @param {string} path
     * @param {Iterable<number>} ids
     * @returns {void}
     */
    setReplace(path, ids) {
        const entry = this._entry(path, STATE_KIND_SET);
        const previous = entry.value;
        entry.value = new Set(ids);
        for (const id of previous) {
            if (!entry.value.has(id)) {
                entry.listeners.notify(id, false);
            }
        }
        for (const id of entry.value) {
            if (!previous.has(id)) {
                entry.listeners.notify(id, true);
            }
        }
    }

    /**
     * The whole tree's declared shape: namespace -> {key: kind}, kinds from STATE_KIND_*.
     * @returns {Object.<string, Object.<string, string>>}
     */
    schema() {
        const tree = {};
        for (const [path, entry] of this._entriesByPath) {
            const [namespace, key] = path.split(".");
            if (tree[namespace] === undefined) {
                tree[namespace] = {};
            }
            tree[namespace][key] = entry.kind;
        }
        return tree;
    }

    /**
     * A plain-JSON snapshot of the whole tree: maps become id-keyed objects, sets arrays.
     * @returns {Object.<string, object>}
     */
    dump() {
        const tree = {};
        for (const [path, entry] of this._entriesByPath) {
            const [namespace, key] = path.split(".");
            if (tree[namespace] === undefined) {
                tree[namespace] = {};
            }
            if (entry.kind === STATE_KIND_MAP) {
                const plain = {};
                for (const [id, value] of entry.value) {
                    plain[id] = value;
                }
                tree[namespace][key] = plain;
            } else if (entry.kind === STATE_KIND_SET) {
                tree[namespace][key] = [...entry.value];
            } else {
                tree[namespace][key] = entry.value;
            }
        }
        return tree;
    }

    /**
     * The leaf at a path, kind-checked; an undeclared path or kind mismatch throws.
     * @private
     * @param {string} path
     * @param {string} [kind]
     * @returns {StateEntry}
     */
    _entry(path, kind) {
        const entry = this._entriesByPath.get(path);
        if (entry === undefined) {
            throw new Error(`Undeclared state path: ${path}`);
        }
        if (kind !== undefined && entry.kind !== kind) {
            throw new Error(`State path ${path} is ${entry.kind}, not ${kind}`);
        }
        return entry;
    }
}
