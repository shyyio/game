// Turns the modules a mod directory holds into a ModPackage. Every loadout goes through here, so a
// mod found on disk and a mod bundled by a vite build register identically.
//
// A part module exports exactly one class, which is the same rule tools/build-mod.js enforces on a
// package it bundles.

import {ModPackage} from "@/common/ModPackage.js";

/**
 * @param {object} namespace a part module
 * @param {string} dir the mod directory it came from
 * @param {string} file the part's file name
 * @returns {Function} the class it exports
 */
export function onlyClass(namespace, dir, file) {
    const names = Object.keys(namespace);
    if (names.length !== 1) {
        throw new Error(`${dir}/${file} must export exactly one class, found ${names.length}`);
    }
    return namespace[names[0]];
}

/**
 * @param {object} source
 * @param {string} file
 * @param {object|null} namespace
 * @returns {object|null} an instance of the part's class, or null when the mod has no such part
 */
function partInstance(source, file, namespace) {
    if (namespace === null) {
        return null;
    }
    return new (onlyClass(namespace, source.dir, file))();
}

/**
 * The loadout for a headless simulation (server, tests): declarations + sim parts.
 * @param {object[]} sources in loadout order
 * @returns {ModPackage[]}
 */
export function simPackagesFrom(sources) {
    return sources.map(source => new ModPackage(
        new (onlyClass(source.declaration, source.dir, "declaration.js"))(),
        {sim: partInstance(source, "sim.js", source.sim)},
    ));
}

/**
 * The loadout for a browser client, which also hosts the local sim: declarations, sim parts and
 * client parts.
 * @param {object[]} sources in loadout order
 * @returns {ModPackage[]}
 */
export function clientPackagesFrom(sources) {
    return sources.map(source => new ModPackage(
        new (onlyClass(source.declaration, source.dir, "declaration.js"))(),
        {
            sim: partInstance(source, "sim.js", source.sim),
            client: partInstance(source, "client.js", source.client),
        },
    ));
}
