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

test("a fresh loadout runs the built-in base mods, which is the loadout local play had all along", () => {
    const loadout = new LocalLoadout([]);

    assert.equal(loadout.builtIn, true);
    assert.equal(LocalLoadout.parse({mods: [chosen("widgets").toJSON()]}).builtIn, true);
});

test("with built-in mods off, a base mod is chosen from the registry like any other", () => {
    const off = new LocalLoadout([]).withBuiltIn(false).with(chosen(BASE_MOD_NAMES[2], "1.0.0"));

    assert.equal(off.builtIn, false);
    assert.deepEqual(off.mods.map(mod => mod.name), [BASE_MOD_NAMES[2]]);
    assert.deepEqual(off.withBuiltIn(true).mods, []);
    assert.equal(off.withBuiltIn(true).builtIn, true);
});

test("a malformed builtIn is refused", () => {
    assert.throws(() => LocalLoadout.parse({mods: [], builtIn: "yes"}), /builtIn/);
});

test("the built-in choice survives JSON, adding, removing, and a refresh", () => {
    const loadout = new LocalLoadout([chosen("widgets", "1.0.0")]).withBuiltIn(false);
    const listings = [listing("widgets", [published("1.0.0"), published("2.0.0")])];

    assert.equal(LocalLoadout.parse(JSON.parse(JSON.stringify(loadout.toJSON()))).builtIn, false);
    assert.equal(loadout.with(chosen("gadgets")).builtIn, false);
    assert.equal(loadout.without("widgets").builtIn, false);
    assert.equal(refreshLoadout(loadout, listings).builtIn, false);
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

    const {lockfile, missing} = serverLockfile(loadout, publishedAll(["widgets"]), GAME);

    assert.deepEqual(missing, []);
    assert.deepEqual(lockfile.mods.map(entry => entry.name), [...BASE_MOD_NAMES, "widgets"]);
    assert.ok(lockfile.mods.every(entry => entry.integrity[MANIFEST_FILE] === HASH));
});

test("with built-in mods off, only the chosen base mods are exported, at their chosen versions", () => {
    const loadout = new LocalLoadout([]).withBuiltIn(false).with(chosen(BASE_MOD_NAMES[1], "1.0.0", true));

    const {lockfile} = serverLockfile(loadout, publishedAll(), GAME);

    assert.deepEqual(lockfile.mods.map(entry => [entry.name, entry.version]), [[BASE_MOD_NAMES[1], "1.0.0"]]);
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

test("a package named after a built-in mod is refused, however it got into the list", () => {
    const clash = chosen(BASE_MOD_NAMES[4]);

    assert.throws(() => new LocalLoadout([clash]), /is built into the client/);
    assert.throws(() => new LocalLoadout([]).with(clash), /is built into the client/);
    assert.throws(() => LocalLoadout.parse({mods: [clash.toJSON()]}), /is built into the client/);
});

test("turning built-in mods off is what makes a base name available to a package", () => {
    assert.throws(() => new LocalLoadout([]).with(chosen(BASE_MOD_NAMES[4])), /is built into the client/);
    assert.doesNotThrow(() => new LocalLoadout([]).withBuiltIn(false).with(chosen(BASE_MOD_NAMES[4])));
});

/**
 * @param {string} name
 * @param {string} version
 * @returns {object} a pinned mods.json entry
 */
function pinnedEntry(name, version) {
    return {url: `file:///mods/${name}/`, name: name, version: version, integrity: {[MANIFEST_FILE]: HASH, "mod.js": OTHER_HASH}};
}

test("a server's mods.json reads back as the base mods it pins plus its other mods, pinned", () => {
    const lockfile = ModLockfile.parse({mods: [
        pinnedEntry(BASE_MOD_NAMES[0], GAME),
        pinnedEntry("widgets", "1.0.0"),
    ]});

    const loadout = LocalLoadout.fromLockfile(lockfile, publishedAll(["widgets"]));

    assert.equal(loadout.builtIn, true);
    assert.deepEqual(loadout.mods.map(mod => [mod.name, mod.title, mod.version, mod.pinned, mod.url]), [
        ["widgets", "The widgets", "1.0.0", true, "file:///mods/widgets/"],
    ]);
});

test("a server whose base mods come from the registry reads back with built-in mods off and each one chosen", () => {
    const lockfile = ModLockfile.parse({mods: [
        {url: `https://mods.example.com/${BASE_MOD_NAMES[0]}/1.0.0/`, name: BASE_MOD_NAMES[0], version: "1.0.0", integrity: {[MANIFEST_FILE]: HASH}},
    ]});

    const loadout = LocalLoadout.fromLockfile(lockfile, publishedAll());

    assert.equal(loadout.builtIn, false);
    assert.deepEqual(loadout.mods.map(mod => [mod.name, mod.version, mod.pinned]), [[BASE_MOD_NAMES[0], "1.0.0", true]]);
    assert.equal(serverLockfile(loadout, publishedAll(), GAME, lockfile).lockfile.mods.length, 1);
});

test("a pinned mod the registry no longer lists reads back titled by its name", () => {
    const lockfile = ModLockfile.parse({mods: [pinnedEntry("widgets", "1.0.0")]});

    assert.equal(LocalLoadout.fromLockfile(lockfile, []).mods[0].title, "widgets");
});

test("exporting over a current mods.json keeps every pin it already has, and pins the rest anew", () => {
    const current = ModLockfile.parse({mods: [pinnedEntry(BASE_MOD_NAMES[0], "0.1.0"), pinnedEntry("widgets", "1.0.0")]});
    const loadout = LocalLoadout.fromLockfile(current, publishedAll(["widgets"]));

    const {lockfile} = serverLockfile(loadout, publishedAll(["widgets"]), GAME, current);

    assert.equal(lockfile.mods.length, BASE_MOD_NAMES.length + 1);
    assert.deepEqual([lockfile.mods[0].name, lockfile.mods[0].url], [BASE_MOD_NAMES[0], `file:///mods/${BASE_MOD_NAMES[0]}/`]);
    assert.deepEqual([lockfile.mods[1].name, lockfile.mods[1].url], ["widgets", "file:///mods/widgets/"]);
    assert.equal(lockfile.mods[2].name, BASE_MOD_NAMES[1]);
});

test("exporting over a current mods.json leaves every pin where it is, so no typeId moves", () => {
    const current = ModLockfile.parse({mods: [
        pinnedEntry(BASE_MOD_NAMES[0], "0.1.0"),
        pinnedEntry("widgets", "1.0.0"),
        pinnedEntry(BASE_MOD_NAMES[1], "0.1.0"),
    ]});
    const loadout = LocalLoadout.fromLockfile(current, publishedAll(["widgets"]));

    const {lockfile} = serverLockfile(loadout, publishedAll(["widgets"]), GAME, current);

    assert.deepEqual(
        lockfile.mods.slice(0, 3).map(mod => mod.name),
        [BASE_MOD_NAMES[0], "widgets", BASE_MOD_NAMES[1]],
    );
    assert.deepEqual(lockfile.mods.slice(3).map(mod => mod.name), BASE_MOD_NAMES.slice(2));
});

test("a loadout stored before built-in mods became one choice reads back with them on", () => {
    const loadout = LocalLoadout.parse({mods: [chosen("widgets").toJSON()], excludedBase: []});
    assert.equal(loadout.builtIn, true);
    assert.deepEqual(loadout.mods.map(mod => mod.name), ["widgets"]);
});

test("a stored loadout that turned off part of the built-in mods says so rather than turning them on", () => {
    assert.throws(
        () => LocalLoadout.parse({mods: [], excludedBase: [BASE_MOD_NAMES[0]]}),
        /no longer a choice/,
    );
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
    assert.equal(loadout.withMoved("a", 1).builtIn, true);
    assert.throws(() => loadout.withMoved("nope", 1), /not chosen/);
});
