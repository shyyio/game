<script setup>
import {onMounted, ref, computed} from "vue";
import {useRouter} from "vue-router";
import {mdiPin, mdiContentCopy, mdiCheck, mdiChevronDown, mdiChevronUp} from "@mdi/js";
import {listMods, tagsOf, displayNameOf, MOD_TAGS, MOD_LISTING_GUIDE_URL} from "@/client/ModRegistryClient.js";
import {BASE_MOD_DIRS, baseModName, baseModTitle} from "@/mods/baseMods.js";
import {
  LocalLoadout,
  LocalMod,
  LOCAL_MOD_SOURCE_URL,
  compatibleVersions,
  latestCompatibleVersion,
  refreshLoadout,
  readLocalLoadout,
  writeLocalLoadout,
  serverLockfile,
} from "@/client/LocalLoadout.js";
import {DEV_TOOLS} from "@/common/env.js";
import {GAME_VERSION} from "@/common/constants.js";
import {formatPastDate} from "@/common/dateFormat.js";
import {startError} from "@/client/GameStart.js";

const router = useRouter();

const mods = ref([]);
const loading = ref(true);
const error = ref("");
const search = ref("");
const activeTags = ref([]);
const expanded = ref(null);
const copied = ref(false);
const localError = ref("");
const loadout = ref(loadStored());
const url = ref("");
const urlError = ref("");
const adding = ref(false);
// A local game that failed to start comes back here with its reason, since this is where its
// loadout was chosen.
const startFailure = ref(startError.value);
startError.value = "";

// The mods the client itself ships, in the order it registers them.
const baseMods = BASE_MOD_DIRS.map((dir) => ({name: baseModName(dir), title: baseModTitle(dir)}));
const baseNames = baseMods.map((mod) => mod.name);

onMounted(load);

/**
 * A stored list that no longer parses is reported rather than silently discarded — it is the pin
 * list for code that is about to run.
 * @returns {LocalLoadout}
 */
function loadStored() {
  try {
    return readLocalLoadout();
  } catch (storedError) {
    localError.value = `${storedError.message} Uncheck everything to start over.`;
    return new LocalLoadout([]);
  }
}

/**
 * Loads the catalog, then moves every version-tracking mod onto the newest version it publishes, so
 * the list shows what a game would actually start with.
 * @returns {Promise<void>}
 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    mods.value = await listMods();
    commit(refreshLoadout(loadout.value, mods.value));
  } catch (loadError) {
    mods.value = [];
    error.value = loadError.message;
  }
  loading.value = false;
}

/**
 * One row of the list. A base mod is listed in the registry like any other, so it would otherwise
 * appear twice — the two are merged by name here into a single row that carries both the listing's
 * description and the fact that the client already ships the code.
 */
class ModRow {

  /**
   * @param {string} name
   * @param {string} title
   * @param {object|null} listing the registry's entry, absent for a base mod nobody has listed yet
   * @param {boolean} base whether the client ships this mod's code
   */
  constructor(name, title, listing, base) {
    this.name = name;
    this.title = title;
    this.listing = listing;
    this.base = base;
  }

  /**
   * @returns {string[]}
   */
  get tags() {
    if (this.listing === null) {
      return [];
    }
    return tagsOf(this.listing);
  }

  /**
   * @returns {string}
   */
  get description() {
    if (this.listing === null) {
      return "";
    }
    return this.listing.description;
  }

  /**
   * @returns {string}
   */
  get author() {
    if (this.listing === null) {
      return "";
    }
    return this.listing.author;
  }
}

// The base mods first, in the order they register, then everything else the registry lists.
const rows = computed(() => {
  const listed = new Map(mods.value.map((mod) => [mod.name, mod]));
  const all = baseMods.map((mod) => {
    const listing = listed.get(mod.name);
    if (listing === undefined) {
      return new ModRow(mod.name, mod.title, null, true);
    }
    return new ModRow(mod.name, displayNameOf(listing), listing, true);
  });
  for (const mod of mods.value) {
    if (!baseNames.includes(mod.name)) {
      all.push(new ModRow(mod.name, displayNameOf(mod), mod, false));
    }
  }
  return all;
});

// Every tag any row carries, in the order tags sort in — the filter row only offers tags that can
// actually match something.
const allTags = computed(() => {
  const tags = new Set();
  for (const row of rows.value) {
    for (const tag of row.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort((left, right) => MOD_TAGS.indexOf(left) - MOD_TAGS.indexOf(right));
});

const shown = computed(() => {
  const term = search.value === null ? "" : search.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (!activeTags.value.every((tag) => row.tags.includes(tag))) {
      return false;
    }
    if (term === "") {
      return true;
    }
    return `${row.title} ${row.name} ${row.description} ${row.tags.join(" ")}`.toLowerCase().includes(term);
  });
});

// Mods loaded straight off a URL are in no catalog, so they are listed where they are added.
const urlMods = computed(() => loadout.value.mods.filter((mod) => mod.source === LOCAL_MOD_SOURCE_URL));

const selectedCount = computed(() => loadout.value.enabledBase.length + loadout.value.mods.length);

const loadoutTitle = computed(() => {
  if (selectedCount.value === 1) {
    return "Mod loadout (1 mod)";
  }
  return `Mod loadout (${selectedCount.value} mods)`;
});

const excludedBaseCount = computed(() => loadout.value.excludedBase.length);

/**
 * @param {LocalLoadout} next
 * @returns {void}
 */
function commit(next) {
  writeLocalLoadout(next);
  loadout.value = next;
  localError.value = "";
}

/**
 * @param {ModRow} row
 * @returns {LocalMod|null}
 */
function chosen(row) {
  return loadout.value.find(row.name);
}

/**
 * @param {string} name the row whose details to open, or close when they already are
 * @returns {void}
 */
function toggleDetails(name) {
  if (expanded.value === name) {
    expanded.value = null;
    return;
  }
  expanded.value = name;
}

/**
 * @param {ModRow} row
 * @returns {boolean}
 */
function selected(row) {
  if (row.base) {
    return loadout.value.baseEnabled(row.name);
  }
  return chosen(row) !== null;
}

/**
 * @param {ModRow} row
 * @returns {boolean}
 */
function isPinned(row) {
  const local = chosen(row);
  return !row.base && local !== null && local.pinned;
}

/**
 * Checking a mod always means "track the newest version"; one exact version is chosen from the
 * version list instead. Unchecking drops it however it was chosen. A base mod has no version to
 * choose — the client ships its code — so it only ever goes on and off.
 * @param {ModRow} row
 * @returns {void}
 */
function toggle(row) {
  if (row.base) {
    commit(loadout.value.withBase(row.name, !loadout.value.baseEnabled(row.name)));
    return;
  }
  if (chosen(row) !== null) {
    commit(loadout.value.without(row.name));
    return;
  }
  useLatest(row);
}

/**
 * @param {ModRow} row
 * @returns {void}
 */
function useLatest(row) {
  const latest = latestCompatibleVersion(row.listing);
  if (latest === null) {
    return;
  }
  pick(row, latest, false);
}

/**
 * @param {ModRow} row
 * @param {object} version
 * @param {boolean} pinned
 * @returns {void}
 */
function pick(row, version, pinned) {
  try {
    commit(loadout.value.with(LocalMod.fromListing(row.listing, version, pinned)));
  } catch (pickError) {
    localError.value = pickError.message;
  }
}

/**
 * The versions of this row this client can load, empty for a base mod (whose code is the client's
 * own) and for a listing that publishes nothing compatible.
 * @param {ModRow} row
 * @returns {object[]}
 */
function versionsOf(row) {
  if (row.base || row.listing === null) {
    return [];
  }
  return compatibleVersions(row.listing);
}

/**
 * Whether this client can load anything this row offers.
 * @param {ModRow} row
 * @returns {boolean}
 */
function loadable(row) {
  return row.base || versionsOf(row).length > 0;
}

/**
 * Whether clicking this row's first line does anything. A mod already in the loadout stays
 * clickable even once nothing it publishes is loadable any more, or there would be no way to take
 * it back out.
 * @param {ModRow} row
 * @returns {boolean}
 */
function togglable(row) {
  return loadable(row) || chosen(row) !== null;
}

/**
 * What the row says about its version, right of its name.
 * @param {ModRow} row
 * @returns {string}
 */
function versionLabel(row) {
  if (row.base) {
    return "built in";
  }
  const local = chosen(row);
  if (local !== null && local.pinned) {
    return `pinned ${local.version}`;
  }
  const latest = latestCompatibleVersion(row.listing);
  if (latest === null) {
    return "no version for this game";
  }
  if (local === null) {
    return latest.version;
  }
  return `latest (${latest.version})`;
}

// What a server needs to run exactly this loadout. Most players never look at it, so it is one
// button at the bottom rather than a blob under every mod.
const exported = computed(() => serverLockfile(loadout.value, mods.value, GAME_VERSION));

const lockfileJson = computed(() => {
  if (exported.value.lockfile === null) {
    return "";
  }
  return `${JSON.stringify(exported.value.lockfile, null, 4)}\n`;
});

/**
 * Ctrl/Cmd+A with the block focused selects the loadout only, rather than the whole page around it.
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function selectJson(event) {
  if (event.key !== "a" || !(event.ctrlKey || event.metaKey)) {
    return;
  }
  event.preventDefault();
  const range = document.createRange();
  range.selectNodeContents(event.currentTarget);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * @returns {Promise<void>}
 */
async function copyLockfile() {
  await navigator.clipboard.writeText(lockfileJson.value);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1500);
}

/**
 * @param {object} version
 * @returns {string}
 */
function versionMeta(version) {
  const sdk = `SDK ${version.sdkVersion}`;
  if (!version.publishedAt) {
    return sdk;
  }
  return `${sdk} · ${formatPastDate(version.publishedAt)}`;
}

/**
 * @returns {Promise<void>}
 */
async function addByUrl() {
  if (url.value.trim() === "" || adding.value) {
    return;
  }
  urlError.value = "";
  adding.value = true;
  try {
    commit(loadout.value.with(await LocalMod.fromUrl(url.value.trim())));
    url.value = "";
  } catch (addError) {
    urlError.value = addError.message;
  } finally {
    adding.value = false;
  }
}

/**
 * @param {string} name
 * @returns {void}
 */
function removeUrlMod(name) {
  commit(loadout.value.without(name));
}

function back() {
  router.push({name: "login"});
}
</script>

<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "ModList",
})
</script>

<template>
  <div class="mod-list">
    <v-card class="mod-list-card" elevation="8">
      <div class="mod-list-back">
        <v-btn variant="text" size="small" @click="back">Back</v-btn>
      </div>
      <v-card-title>Mods</v-card-title>
      <v-card-text>
        <div class="mod-list-note">
          Installed mods for local play.
        </div>
        <v-text-field
            v-model="search"
            label="Filter"
            autocomplete="off"
            hide-details
            class="my-4"
        />
        <v-chip-group v-model="activeTags" class="mod-list-tags" column multiple filter>
          <v-chip v-for="tag in allTags" :key="tag" :value="tag" size="small">{{ tag }}</v-chip>
        </v-chip-group>
        <div v-if="startFailure" class="mod-list-error">The last local game could not start: {{ startFailure }}</div>
        <div v-if="localError" class="mod-list-error">{{ localError }}</div>
        <div v-if="error" class="mod-list-error">{{ error }}</div>
        <div
            class="mod-list-note mod-list-warn"
            :class="{'mod-list-warn-idle': excludedBaseCount === 0}"
        >
          Turning off built-in mods may break the game.
        </div>
        <div v-if="loading" class="mod-list-empty">Loading…</div>
        <div v-else-if="shown.length === 0" class="mod-list-empty">No mod matches that filter</div>
        <v-list v-else class="mod-rows">
          <div v-for="row in shown" :key="row.name" class="mod-row-wrap">
            <v-list-item :class="{'mod-row-inert': !togglable(row)}" @click="toggle(row)">
              <template #prepend>
                <v-checkbox-btn
                    :model-value="selected(row)"
                    :disabled="!togglable(row)"
                    :color="isPinned(row) ? 'warning' : 'primary'"
                    :true-icon="isPinned(row) ? mdiPin : '$checkboxOn'"
                    hide-details
                    tabindex="-1"
                    @click.stop="toggle(row)"
                />
              </template>
              <div class="mod-row-body">
                <div class="mod-row-head">
                  <span class="mod-row-name">{{ row.title }}</span>
                  <span class="mod-row-meta">{{ versionLabel(row) }}</span>
                  <v-chip
                      v-for="tag in row.tags"
                      :key="tag"
                      size="x-small"
                      variant="tonal"
                      @click.stop="activeTags = [tag]"
                  >{{ tag }}</v-chip>
                </div>
                <div v-if="row.description" class="mod-row-desc">{{ row.description }}</div>
                <div v-if="row.author" class="mod-row-meta">{{ row.author }}</div>
              </div>
              <template #append>
                <v-btn
                    :icon="expanded === row.name ? mdiChevronUp : mdiChevronDown"
                    :aria-label="expanded === row.name ? 'Hide details' : 'Show details'"
                    variant="text"
                    @click.stop="toggleDetails(row.name)"
                />
              </template>
            </v-list-item>
            <div v-if="expanded === row.name" class="mod-row-details">
              <div v-if="row.listing" class="mod-row-meta">
                <a :href="row.listing.repo" target="_blank" rel="noreferrer">source</a>
                <template v-if="row.listing.homepage">
                  &middot; <a :href="row.listing.homepage" target="_blank" rel="noreferrer">homepage</a>
                </template>
              </div>
              <div v-if="row.base" class="mod-list-empty">Updates with the game.</div>
              <div v-else-if="!loadable(row)" class="mod-list-empty">
                Nothing this mod has published runs on this version of the game.
              </div>
              <v-list v-else class="mod-versions" density="compact" nav>
                <v-list-item
                    :active="chosen(row) !== null && !isPinned(row)"
                    title="Newest release"
                    subtitle="Automatic updates"
                    @click="useLatest(row)"
                />
                <v-list-item
                    v-for="version in versionsOf(row)"
                    :key="version.version"
                    :active="isPinned(row) && chosen(row).version === version.version"
                    :title="version.version"
                    :subtitle="versionMeta(version)"
                    @click="pick(row, version, true)"
                />
              </v-list>
            </div>
          </div>
        </v-list>
        <div class="mod-list-actions">
          <v-btn variant="text" size="small" :href="MOD_LISTING_GUIDE_URL" target="_blank" rel="noreferrer">
            Publish a mod
          </v-btn>
        </div>

        <div v-if="DEV_TOOLS" class="mod-list-sideload">
          <div class="mod-list-note">
            Load a package you are building straight off its URL. Nothing is pinned or cached, so it
            reloads on every start.
          </div>
          <v-list v-if="urlMods.length > 0" density="compact">
            <v-list-item
                v-for="mod in urlMods"
                :key="mod.name"
                :title="mod.title"
                :subtitle="`${mod.name} ${mod.version} · ${mod.url}`"
            >
              <template #append>
                <v-btn variant="text" size="small" @click="removeUrlMod(mod.name)">Remove</v-btn>
              </template>
            </v-list-item>
          </v-list>
          <v-text-field
              v-model="url"
              label="Package URL"
              placeholder="http://localhost:5050/mod/"
              autocomplete="off"
              hide-details
              :disabled="adding"
              @keyup.enter="addByUrl"
          />
          <div v-if="urlError" class="mod-list-error">{{ urlError }}</div>
          <div class="mod-list-actions">
            <v-btn size="small" variant="flat" color="primary" :loading="adding" @click="addByUrl">Add</v-btn>
          </div>
        </div>

        <div class="mod-list-export">
          <div class="mod-list-heading">{{ loadoutTitle }}</div>
          <div class="mod-list-note">Run it on a server: paste this into the server's mods.json.</div>
          <div v-if="exported.missing.length > 0" class="mod-list-empty">
            The registry has no {{ GAME_VERSION }} of {{ exported.missing.join(", ") }} yet.
          </div>
          <div v-if="exported.skipped.length > 0" class="mod-list-empty">
            Left out, no hashes to pin: {{ exported.skipped.join(", ") }}.
          </div>
          <template v-if="exported.lockfile">
            <div class="mod-list-json">
              <pre tabindex="0" @keydown="selectJson">{{ lockfileJson }}</pre>
              <v-btn
                  class="mod-list-json-copy"
                  :icon="copied ? mdiCheck : mdiContentCopy"
                  :aria-label="copied ? 'Copied' : 'Copy mods.json'"
                  :title="copied ? 'Copied' : 'Copy mods.json'"
                  size="small"
                  variant="text"
                  @click="copyLockfile"
              />
            </div>
          </template>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.mod-list {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8vh;
  background: #f5f0e6;
  overflow-y: auto;
}

.mod-list-card {
  width: min(94vw, 860px);
  margin-bottom: 32px;
}

/* On a phone the catalog is the whole screen: a full-bleed sheet, no background showing around it. */
@media (max-width: 600px) {
  .mod-list {
    padding-top: 0;
  }

  .mod-list-card {
    width: 100%;
    min-height: 100%;
    margin-bottom: 0;
    border-radius: 0;
  }
}

.mod-list-back {
  padding: 8px 8px 0;
}

.mod-list-note {
  opacity: 0.65;
  font-size: 0.8125rem;
}

/* Always in the layout, only sometimes visible: appearing on a toggle would shift the list under
   the pointer, and the next mod would no longer be where it was clicked. */
.mod-list-warn {
  margin: 12px 0;
  opacity: 0.85;
}

.mod-list-warn-idle {
  visibility: hidden;
}

.mod-list-empty {
  opacity: 0.7;
  font-size: 0.875rem;
  margin-top: 12px;
}

.mod-list-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 12px;
}

.mod-list-tags {
  margin-bottom: 4px;
}

.mod-list-heading {
  font-weight: 600;
  margin-bottom: 4px;
}

.mod-list-json {
  position: relative;
  margin: 12px 0 0;
}

/* A tall loadout scrolls in place; the copy button rides on the wrapper, so it stays put. */
.mod-list-json pre {
  max-height: 220px;
  overflow: auto;
  overflow-x: hidden;
  background: rgba(0, 0, 0, 0.06);
  /* Same hairline the section dividers use, so the block reads as one enclosed thing. */
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  /* Right padding keeps the JSON from running under the button. */
  padding: 8px 60px 8px 10px;
  margin: 0;
  font-size: 0.75rem;
}

.mod-list-json-copy {
  position: absolute;
  top: 8px;
  right: 20px;
}

.mod-list-sideload,
.mod-list-export {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}

/* The forward action sits rightmost, per docs/ux-conventions.md. */
.mod-list-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

/* A v-list-item rather than a v-expansion-panel: the whole row is its click target already, and a
   panel title is a <button> whose absolutely positioned overlay swallows clicks meant for anything
   nested inside it. */
.mod-rows {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
  margin-top: 4px;
  padding: 0;
  background: transparent;
}

.mod-row-inert {
  cursor: default;
}

.mod-row-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mod-row-body {
  min-width: 0;
  padding: 4px 0;
}

/* 16px of list-item padding + a 40px checkbox + a 16px spacer, so this lines up under the row's
   title rather than under its checkbox. */
.mod-row-details {
  padding: 8px 16px 16px 72px;
}

/* The rows inside are already in that indent and must not add their own on top of it. */
.mod-row-details :deep(.v-list-item) {
  padding-inline: 8px;
}

.mod-row-name {
  font-weight: 600;
}

.mod-row-meta {
  opacity: 0.65;
  font-size: 0.8125rem;
}

.mod-row-desc {
  font-size: 0.9375rem;
  opacity: 0.85;
  margin-top: 4px;
  margin-bottom: 4px;
}

.mod-versions {
  padding: 4px 0;
  background: transparent;
}
</style>
