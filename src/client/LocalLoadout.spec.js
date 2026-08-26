import {test} from "node:test";
import assert from "node:assert/strict";
import {
    LocalLoadout,
    LocalMod,
    LOCAL_MOD_SOURCE_REGISTRY,
    LOCAL_MOD_SOURCE_URL,
    BASE_MOD_NAMES,
    compatibleVersions,
    latestCompatibleVersion,
    refreshLoadout,
    serverLockfile,
} from "@/client/LocalLoadout.js";
import {formatIntegrity} from "@/common/ModIntegrity.js";
import {SDK_VERSION} from "@/common/ModManifest.js";
import {MANIFEST_FILE} from "@/common/ModLockfile.js";

const HASH = formatIntegrity("a".repeat(64));
const OTHER_HASH = formatIntegrity("b".repeat(64));

/**
 * @param {string} version
 * @param {number} [sdkVersion]
 * @returns {object} a published version, as the registry index carries it
 */
function published(version, sdkVersion=SDK_VERSION) {
    return {
        version: version,
        url: `https://mods.example.com/widgets/${version}/`,
        sdkVersion: sdkVersion,
        artifacts: {[MANIFEST_FILE]: HASH, "mod.js": OTHER_HASH},
    };
}

/**
 * @param {string} name
 * @param {object[]} versions oldest first, as the registry publishes them
 * @returns {object} a listed mod
 */
function listing(name, versions) {
    return {name: name, title: `The ${name}`, versions: versions};
}

/**
 * @param {string} name
 * @param {string} [version]
 * @param {boolean} [pinned]
 * @returns {LocalMod}
 */
function chosen(name, version="1.0.0", pinned=false) {
    return LocalMod.fromListing(listing(name, [published(version)]), published(version), pinned);
}

test("a chosen mod round-trips through JSON", () => {
    const mod = chosen("widgets");
    const parsed = LocalMod.parse(JSON.parse(JSON.stringify(mod.toJSON())));

    assert.equal(parsed.name, "widgets");
    assert.equal(parsed.source, LOCAL_MOD_SOURCE_REGISTRY);
    assert.equal(parsed.pinned, false);
    assert.deepEqual([...parsed.integrity], [...mod.integrity]);
});

test("a chosen mod becomes the same lockfile entry a server would pin", () => {
    const entry = chosen("widgets", "2.1.0").lockEntry;

    assert.equal(entry.name, "widgets");
    assert.equal(entry.version, "2.1.0");
    assert.equal(entry.integrityOf("mod.js"), OTHER_HASH);
});

test("only an unpinned registry mod tracks the newest version", () => {
    assert.equal(chosen("widgets", "1.0.0", false).tracksLatest, true);
    assert.equal(chosen("widgets", "1.0.0", true).tracksLatest, false);

    const fromUrl = new LocalMod(LOCAL_MOD_SOURCE_URL, "widgets", "W", "http://localhost:5050/mod/", "1.0.0", null, false);
    assert.equal(fromUrl.tracksLatest, false);
});

test("a mod served off a URL has no lockfile entry and cannot be pinned", () => {
    const mod = new LocalMod(LOCAL_MOD_SOURCE_URL, "widgets", "W", "http://localhost:5050/mod/", "1.0.0", null, false);

    assert.throws(() => mod.lockEntry, /no file hashes/);
    assert.equal(mod.toJSON().integrity, undefined);
    assert.equal(LocalMod.parse(mod.toJSON()).integrity, null);
    assert.throws(() => LocalMod.parse({...mod.toJSON(), pinned: true}), /no version to pin/);
});

test("a registry mod without an integrity map is refused", () => {
    assert.throws(
        () => LocalMod.parse({
            source: LOCAL_MOD_SOURCE_REGISTRY, name: "x", title: "X", url: "https://e/", version: "1.0.0", pinned: false,
        }),
        /no integrity map/,
    );
});

test("a registry mod that does not pin its manifest is refused", () => {
    assert.throws(
        () => LocalMod.parse({
            source: LOCAL_MOD_SOURCE_REGISTRY,
            name: "x",
            title: "X",
            url: "https://e/",
            version: "1.0.0",
            pinned: false,
            integrity: {"mod.js": HASH},
        }),
        /does not pin mod\.json/,
    );
});

test("an unknown source, an unknown key, a bad url, and a missing pinned flag are all refused", () => {
    const base = {
        source: LOCAL_MOD_SOURCE_REGISTRY,
        name: "x",
        title: "X",
        url: "https://e/",
        version: "1.0.0",
        pinned: false,
        integrity: {[MANIFEST_FILE]: HASH},
    };

    assert.throws(() => LocalMod.parse({...base, source: "whatever"}), /Unknown local loadout source/);
    assert.throws(() => LocalMod.parse({...base, extra: 1}), /Unknown key "extra"/);
    assert.throws(() => LocalMod.parse({...base, url: "https://e"}), /must end in/);
    assert.throws(() => LocalMod.parse({...base, pinned: undefined}), /does not say whether/);
});

test("a listing with no published file hashes is refused rather than loaded unverified", () => {
    assert.throws(
        () => LocalMod.fromListing(listing("widgets", []), {version: "1.2.0", url: "https://e/"}, false),
        /no file hashes/,
    );
});

test("a listing without a title falls back to the identifier", () => {
    const mod = LocalMod.fromListing({name: "widgets", versions: []}, published("1.2.0"), false);

    assert.equal(mod.title, "widgets");
});

test("only versions built for this client's SDK are offered, newest first", () => {
    const mod = listing("widgets", [
        published("1.0.0", SDK_VERSION - 1),
        published("2.0.0"),
        published("3.0.0", SDK_VERSION + 1),
        published("2.5.0"),
    ]);

    assert.deepEqual(compatibleVersions(mod).map(version => version.version), ["2.5.0", "2.0.0"]);
    assert.equal(latestCompatibleVersion(mod).version, "2.5.0");
});

test("a mod publishing nothing for this SDK has no version to offer", () => {
    const mod = listing("widgets", [published("1.0.0", SDK_VERSION - 1)]);

    assert.deepEqual(compatibleVersions(mod), []);
    assert.equal(latestCompatibleVersion(mod), null);
    assert.deepEqual(compatibleVersions({name: "widgets"}), []);
});

test("a refresh moves a tracking mod onto the newest compatible version", () => {
    const loadout = new LocalLoadout([chosen("widgets", "1.0.0")]);
    const listings = [listing("widgets", [published("1.0.0"), published("2.0.0"), published("9.0.0", SDK_VERSION + 1)])];

    const refreshed = refreshLoadout(loadout, listings);

    assert.equal(refreshed.find("widgets").version, "2.0.0");
    assert.equal(refreshed.find("widgets").pinned, false);
});

test("a refresh leaves a pinned mod exactly where it was", () => {
    const loadout = new LocalLoadout([chosen("widgets", "1.0.0", true)]);
    const listings = [listing("widgets", [published("1.0.0"), published("2.0.0")])];

    assert.equal(refreshLoadout(loadout, listings).find("widgets").version, "1.0.0");
});

test("a refresh keeps the last resolved version when the listing is gone or no longer compatible", () => {
    const loadout = new LocalLoadout([chosen("widgets", "1.0.0"), chosen("gadgets", "1.0.0")]);
    const listings = [listing("gadgets", [published("2.0.0", SDK_VERSION + 1)])];

    const refreshed = refreshLoadout(loadout, listings);

    assert.equal(refreshed.find("widgets").version, "1.0.0");
    assert.equal(refreshed.find("gadgets").version, "1.0.0");
});

test("a loadout tracks the latest only while something in it is unpinned", () => {
    assert.equal(new LocalLoadout([]).tracksLatest, false);
    assert.equal(new LocalLoadout([chosen("a", "1.0.0", true)]).tracksLatest, false);
    assert.equal(new LocalLoadout([chosen("a", "1.0.0", true), chosen("b")]).tracksLatest, true);
});

test("adding appends, and re-choosing the same mod keeps its position", () => {
    const loadout = new LocalLoadout([]).with(chosen("a")).with(chosen("b")).with(chosen("c"));

    assert.deepEqual(loadout.mods.map(mod => mod.name), ["a", "b", "c"]);

    const pinnedA = loadout.with(chosen("a", "2.0.0", true));
    assert.deepEqual(pinnedA.mods.map(mod => mod.name), ["a", "b", "c"]);
    assert.equal(pinnedA.find("a").version, "2.0.0");
    assert.equal(pinnedA.find("a").pinned, true);
});

test("removing drops only that mod, and leaves the rest in order", () => {
    const loadout = new LocalLoadout([chosen("a"), chosen("b"), chosen("c")]).without("b");

    assert.deepEqual(loadout.mods.map(mod => mod.name), ["a", "c"]);
    assert.equal(loadout.find("b"), null);
});

test("a loadout round-trips through JSON", () => {
    const loadout = new LocalLoadout([chosen("a"), chosen("b", "3.0.0", true)]);
    const parsed = LocalLoadout.parse(JSON.parse(JSON.stringify(loadout.toJSON())));

    assert.deepEqual(parsed.mods.map(mod => `${mod.name}@${mod.version}`), ["a@1.0.0", "b@3.0.0"]);
    assert.deepEqual(parsed.mods.map(mod => mod.pinned), [false, true]);
});

test("a loadout listing the same mod twice is refused", () => {
    assert.throws(
        () => LocalLoadout.parse({mods: [chosen("a").toJSON(), chosen("a", "2.0.0").toJSON()]}),
        /lists "a" twice/,
    );
});

test("a stored value that is not a loadout is refused rather than treated as empty", () => {
    assert.throws(() => LocalLoadout.parse({}), /must hold a `mods` array/);
    assert.throws(() => LocalLoadout.parse(null), /must hold a `mods` array/);
});

test("a fresh loadout loads every base mod, which is the loadout local play had all along", () => {
    const loadout = new LocalLoadout([]);

    assert.deepEqual(loadout.enabledBase, BASE_MOD_NAMES);
    assert.deepEqual(loadout.excludedBase, []);
    assert.equal(loadout.baseEnabled(BASE_MOD_NAMES[0]), true);
});

test("a stored loadout from before base mods could be turned off still loads all of them", () => {
    const parsed = LocalLoadout.parse({mods: [chosen("widgets").toJSON()]});

    assert.deepEqual(parsed.enabledBase, BASE_MOD_NAMES);
});

test("turning a base mod off drops only that one, and keeps the rest in registration order", () => {
    const off = new LocalLoadout([]).withBase(BASE_MOD_NAMES[2], false);

    assert.equal(off.baseEnabled(BASE_MOD_NAMES[2]), false);
    assert.deepEqual(off.enabledBase, BASE_MOD_NAMES.filter(name => name !== BASE_MOD_NAMES[2]));
    assert.deepEqual(off.withBase(BASE_MOD_NAMES[2], true).enabledBase, BASE_MOD_NAMES);
});

test("turning a base mod off twice does not list it twice", () => {
    const off = new LocalLoadout([]).withBase(BASE_MOD_NAMES[0], false).withBase(BASE_MOD_NAMES[0], false);

    assert.deepEqual(off.excludedBase, [BASE_MOD_NAMES[0]]);
});

test("a base mod that does not exist is refused rather than stored as a dead name", () => {
    assert.throws(() => new LocalLoadout([]).withBase("not-a-base-mod", false), /No base mod called/);
});

test("an unknown excluded name is ignored, so a renamed base mod never turns off a different one", () => {
    const parsed = LocalLoadout.parse({mods: [], excludedBase: ["retired-mod"]});

    assert.deepEqual(parsed.enabledBase, BASE_MOD_NAMES);
});

test("a malformed excludedBase is refused", () => {
    assert.throws(() => LocalLoadout.parse({mods: [], excludedBase: "logistics"}), /excludedBase/);
    assert.throws(() => LocalLoadout.parse({mods: [], excludedBase: [1]}), /excludedBase/);
});

test("base choices survive JSON, adding, removing, and a refresh", () => {
    const loadout = new LocalLoadout([chosen("widgets", "1.0.0")]).withBase(BASE_MOD_NAMES[1], false);
    const listings = [listing("widgets", [published("1.0.0"), published("2.0.0")])];

    assert.deepEqual(LocalLoadout.parse(JSON.parse(JSON.stringify(loadout.toJSON()))).excludedBase, [BASE_MOD_NAMES[1]]);
    assert.deepEqual(loadout.with(chosen("gadgets")).excludedBase, [BASE_MOD_NAMES[1]]);
    assert.deepEqual(loadout.without("widgets").excludedBase, [BASE_MOD_NAMES[1]]);
    assert.deepEqual(refreshLoadout(loadout, listings).excludedBase, [BASE_MOD_NAMES[1]]);
});

const GAME = "2.9.0";

/**
 * @param {string[]} [extra] names of non-base mods to publish alongside every base mod
 * @returns {object[]} a registry index publishing every base mod at GAME
 */
function publishedAll(extra=[]) {
    return [...BASE_MOD_NAMES, ...extra].map((name) => listing(name, [published("9.9.9"), published(GAME)]));
}

test("the exported mods.json pins every base mod at this game version, in registration order", () => {
    const loadout = new LocalLoadout([chosen("widgets", GAME)]);

    const {lockfile, missing, skipped} = serverLockfile(loadout, publishedAll(["widgets"]), GAME);

    assert.deepEqual(missing, []);
    assert.deepEqual(skipped, []);
    assert.deepEqual(lockfile.mods.map(entry => entry.name), [...BASE_MOD_NAMES, "widgets"]);
    assert.ok(lockfile.mods.every(entry => entry.integrity[MANIFEST_FILE] === HASH));
});

test("a base mod turned off is left out of the exported mods.json", () => {
    const loadout = new LocalLoadout([]).withBase(BASE_MOD_NAMES[1], false);

    const {lockfile} = serverLockfile(loadout, publishedAll(), GAME);

    assert.deepEqual(lockfile.mods.map(entry => entry.name), BASE_MOD_NAMES.filter(n => n !== BASE_MOD_NAMES[1]));
});

test("a chosen mod is exported at the version it is actually set to, not the newest", () => {
    const loadout = new LocalLoadout([chosen("widgets", "1.0.0", true)]);
    const listings = [...publishedAll(), listing("widgets", [published("1.0.0"), published("2.0.0")])];

    const {lockfile} = serverLockfile(loadout, listings, GAME);

    assert.equal(lockfile.mods.find(entry => entry.name === "widgets").version, "1.0.0");
});

test("nothing is exported while a base mod has no publication to pin, rather than a partial file", () => {
    const listings = publishedAll().filter(mod => mod.name !== BASE_MOD_NAMES[0]);

    const {lockfile, missing} = serverLockfile(new LocalLoadout([]), listings, GAME);

    assert.equal(lockfile, null);
    assert.deepEqual(missing, [BASE_MOD_NAMES[0]]);
});

test("a base mod published at this version but without file hashes counts as unpinnable", () => {
    const listings = publishedAll().map((mod) => {
        if (mod.name !== BASE_MOD_NAMES[0]) {
            return mod;
        }
        return listing(mod.name, [{version: GAME, url: "https://e/", sdkVersion: SDK_VERSION}]);
    });

    assert.deepEqual(serverLockfile(new LocalLoadout([]), listings, GAME).missing, [BASE_MOD_NAMES[0]]);
});

test("a mod loaded off a bare URL is reported as skipped, not silently dropped", () => {
    const fromUrl = new LocalMod(LOCAL_MOD_SOURCE_URL, "widgets", "W", "http://localhost:5050/mod/", "1.0.0", null, false);

    const {lockfile, skipped} = serverLockfile(new LocalLoadout([fromUrl]), publishedAll(), GAME);

    assert.deepEqual(skipped, ["widgets"]);
    assert.deepEqual(lockfile.mods.map(entry => entry.name), BASE_MOD_NAMES);
});
