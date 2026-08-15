// A stand-in for the real SDK, for checking a mod without a game engine to hand.
//
// Every property is a constructible, callable stub that answers any further property with another
// stub, so a declaration can extend `sdk.AbstractModDeclaration`, build `sdk.ObjectType`s, and read
// constants off it without any of them existing. What this proves is narrow but real: the bundle
// evaluates, its factories run, and nothing blows up at import time. It cannot tell whether the
// content is *valid* — that needs the engine, which is why the registry's first-party mods are
// checked against a real ModRegistry instead.

/**
 * @param {string} path how this stub was reached, for error messages
 * @returns {Function} a stub that is callable, constructible, and endlessly traversable
 */
function stub(path) {
    const target = function stubbed() {};
    Object.defineProperty(target, "name", {value: path});
    return new Proxy(target, {
        get(unused, property) {
            if (property === Symbol.toPrimitive || property === Symbol.toStringTag) {
                return undefined;
            }
            if (property === "then") {
                // Stubs must not look thenable, or awaiting one hangs.
                return undefined;
            }
            if (typeof property === "symbol") {
                return undefined;
            }
            return stub(`${path}.${property}`);
        },
        // A stub swallows whatever a mod does with it, in either call form.
        apply() {
            return stub(`${path}()`);
        },
        construct() {
            return stub(`new ${path}`);
        },
        // Every property answers, so an `in` check against the SDK reads as present.
        has() {
            return true;
        },
    });
}

/**
 * The stub SDK object handed to a mod's factories.
 * @returns {object}
 */
export function stubSdk() {
    return stub("sdk");
}
