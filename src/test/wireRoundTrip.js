// Wire codec checks shared by the mods' wire specs.

import assert from "node:assert";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {WireRegistry} from "@/common/wire.js";

/**
 * A wire registry over one mod's declaration alone.
 * @param {AbstractModDeclaration} declaration
 * @returns {WireRegistry}
 */
export function wireRegistryFor(declaration) {
    const modRegistry = new ModRegistry();
    modRegistry.register(new ModPackage(declaration));
    modRegistry.freeze();
    return new WireRegistry(modRegistry);
}

/**
 * Reduces an object to its declared wire fields, mapping undefined to null so absent-on-the-wire
 * fields compare equal to the source.
 * @param {object} obj
 * @param {Function} cls
 * @returns {object}
 */
function pick(obj, cls) {
    const out = {};
    for (const key of Object.keys(cls.wireFields)) {
        out[key] = obj[key] === undefined ? null : obj[key];
    }
    return out;
}

/**
 * Asserts an instance survives encode + decode as the same class with the same wire fields.
 * @param {WireRegistry} reg
 * @param {AbstractWireObject} instance
 * @param {Function} cls
 * @returns {void}
 */
export function assertRoundTrip(reg, instance, cls) {
    const decoded = reg.decode(reg.encode(instance));
    assert.ok(decoded instanceof cls, `decoded value is not a ${cls.name}`);
    assert.deepStrictEqual(pick(decoded, cls), pick(instance, cls));
}
