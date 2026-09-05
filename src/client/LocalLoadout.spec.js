import {test} from "node:test";
import assert from "node:assert/strict";
import {
    LocalLoadout,
    LocalMod,
    BASE_MOD_NAMES,
    compatibleVersions,
    latestCompatibleVersion,
    refreshLoadout,
    serverLockfile,
} from "@/client/LocalLoadout.js";
import {formatIntegrity} from "@/common/ModIntegrity.js";
import {SDK_VERSION} from "@/common/ModManifest.js";
import {MANIFEST_FILE, ModLockfile} from "@/common/ModLockfile.js";

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
    assert.equal(parsed.pinned, false);
    assert.deepEqual([...parsed.integrity], [...mod.integrity]);
});

test("a chosen mod becomes the same lockfile entry a server would pin", () => {
    const entry = chosen("widgets", "2.1.0").lockEntry;

    assert.equal(entry.name, "widgets");
    assert.equal(entry.version, "2.1.0");
    assert.equal(entry.integrityOf("mod.js"), OTHER_HASH);
});

test("only an unpinned mod tracks the newest version", () => {
    assert.equal(chosen("widgets", "1.0.0", false).tracksLatest, true);
    assert.equal(chosen("widgets", "1.0.0", true).tracksLatest, false);
});

test("a registry mod without an integrity map is refused", () => {
    assert.throws(
        () => LocalMod.parse({name: "x", title: "X", url: "https://e/", version: "1.0.0", pinned: false}),
        /no integrity map/,
    );
});

test("a registry mod that does not pin its manifest is refused", () => {
    assert.throws(
        () => LocalMod.parse({
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

test("an unknown key, a bad url, and a missing pinned flag are all refused", () => {
    const base = {
        name: "x",
        title: "X",
        url: "https://e/",
        version: "1.0.0",
        pinned: false,
        integrity: {[MANIFEST_FILE]: HASH},
    };

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

const GAME = "2.9.0";

/**
 * @param {string} name
 * @param {string} version
 * @returns {object} an entry of a server's mod list
 */
function listedEntry(name, version) {
    return {url: `https://mods.example.com/${name}/${version}/`, name, version, integrity: {[MANIFEST_FILE]: HASH, "mod.js": OTHER_HASH}};
}

test("the exported mod list holds the chosen mods, in load order", () => {
    const loadout = new LocalLoadout([chosen("widgets", GAME), chosen("gadgets", GAME)]);

    const lockfile = serverLockfile(loadout);

    assert.deepEqual(lockfile.mods.map(entry => entry.name), ["widgets", "gadgets"]);
    assert.ok(lockfile.mods.every(entry => entry.integrity[MANIFEST_FILE] === HASH));
});

test("a chosen mod is exported at the version it is actually set to, not the newest", () => {
    const lockfile = serverLockfile(new LocalLoadout([chosen("widgets", "1.0.0", true)]));

    assert.equal(lockfile.mods.find(entry => entry.name === "widgets").version, "1.0.0");
});

test("a package named after a built-in mod is refused, however it got into the list", () => {
    const clash = chosen(BASE_MOD_NAMES[4]);

    assert.throws(() => new LocalLoadout([clash]), /is built into the client/);
    assert.throws(() => new LocalLoadout([]).with(clash), /is built into the client/);
    assert.throws(() => LocalLoadout.parse({mods: [clash.toJSON()]}), /is built into the client/);
});

test("a server's mod list reads back as the mods it runs, each at its exact version", () => {
    const lockfile = ModLockfile.parse({mods: [listedEntry("widgets", "1.0.0")]});

    const loadout = LocalLoadout.fromLockfile(lockfile, [listing("widgets", [published("1.0.0")])]);

    assert.deepEqual(loadout.mods.map(mod => [mod.name, mod.title, mod.version, mod.pinned]), [
        ["widgets", "The widgets", "1.0.0", true],
    ]);
});

test("a mod the registry no longer lists reads back titled by its name", () => {
    const lockfile = ModLockfile.parse({mods: [listedEntry("widgets", "1.0.0")]});

    assert.equal(LocalLoadout.fromLockfile(lockfile, []).mods[0].title, "widgets");
});

test("exporting over a server's current list leaves every entry where it is, so no typeId moves", () => {
    const current = ModLockfile.parse({mods: [listedEntry("widgets", "1.0.0"), listedEntry("gadgets", "1.0.0")]});
    const loadout = LocalLoadout.fromLockfile(current, []).with(chosen("sprockets", GAME));

    const lockfile = serverLockfile(loadout, current);

    assert.deepEqual(lockfile.mods.map(entry => entry.name), ["widgets", "gadgets", "sprockets"]);
    assert.equal(lockfile.mods[0].url, "https://mods.example.com/widgets/1.0.0/");
});

test("an unknown key in a stored loadout is refused", () => {
    assert.throws(() => LocalLoadout.parse({mods: [], nonsense: 1}), /Unknown key/);
});

test("a chosen mod moves up or down the load order, and stops at the ends", () => {
    const loadout = new LocalLoadout([chosen("a"), chosen("b"), chosen("c")]);
    assert.deepEqual(loadout.withMoved("c", -1).mods.map(mod => mod.name), ["a", "c", "b"]);
    assert.deepEqual(loadout.withMoved("a", 1).mods.map(mod => mod.name), ["b", "a", "c"]);
    assert.deepEqual(loadout.withMoved("a", -1).mods.map(mod => mod.name), ["a", "b", "c"]);
    assert.deepEqual(loadout.withMoved("c", 1).mods.map(mod => mod.name), ["a", "b", "c"]);
    assert.throws(() => loadout.withMoved("nope", 1), /not chosen/);
});
