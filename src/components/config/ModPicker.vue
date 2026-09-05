<script setup>
import {computed, ref} from "vue";
import {mdiPin, mdiChevronDown, mdiChevronUp, mdiArrowUp, mdiArrowDown} from "@mdi/js";
import {tagsOf, displayNameOf, MOD_TAGS, MOD_LISTING_GUIDE_URL} from "@/client/ModRegistryClient.js";
import {MOD_DIRS} from "@/mods/modDirs.js";
import {modName, modTitle} from "@/mods/modNames.js";
import {
  LocalMod, compatibleVersions, latestCompatibleVersion, publishedVersions, versionLoadable,
} from "@/client/LocalLoadout.js";
import {SDK_VERSION} from "@/common/ModManifest.js";
import {formatPastDate} from "@/common/dateFormat.js";

const props = defineProps({
  loadout: {type: Object, required: true},
  listings: {type: Array, required: true},
  loading: {type: Boolean, required: true},
  error: {type: String, default: ""},
  // What the built-in row says the base mods come with.
  builtInDescription: {type: String, default: "Shipped with the game client"},
});
const emit = defineEmits(["update:loadout"]);

const search = ref("");
const activeTags = ref([]);
const expanded = ref(null);
const pickError = ref("");

// The mods the game itself ships, in the order it registers them.
const baseMods = MOD_DIRS.map((dir) => ({name: modName(dir), title: modTitle(dir)}));
const baseNames = baseMods.map((mod) => mod.name);

/**
 * One row of the list. The base mods sit behind the single built-in row, which is not a choice: the
 * client runs the copy it was built with.
 */
class ModRow {

  /**
   * @param {string} name
   * @param {string} title
   * @param {object|null} listing the registry's entry, absent for a base mod nobody has listed yet
   */
  constructor(name, title, listing) {
    this.name = name;
    this.title = title;
    this.listing = listing;
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

const rows = computed(() => {
  const listed = new Map(props.listings.map((mod) => [mod.name, mod]));
  const titleOfBase = new Map(baseMods.map((mod) => [mod.name, mod.title]));
  const rowFor = name => {
    const listing = listed.get(name);
    if (listing !== undefined) {
      return new ModRow(name, displayNameOf(listing), listing);
    }
    const local = props.loadout.find(name);
    if (local !== null) {
      return new ModRow(name, local.title, null);
    }
    return new ModRow(name, titleOfBase.has(name) ? titleOfBase.get(name) : name, null);
  };
  // The chosen mods first, in load order, since that order is what the arrows change.
  const all = props.loadout.mods.map((mod) => rowFor(mod.name));
  const chosen = new Set(props.loadout.mods.map((mod) => mod.name));
  for (const mod of props.listings) {
    if (!baseNames.includes(mod.name) && !chosen.has(mod.name)) {
      all.push(rowFor(mod.name));
    }
  }
  return all;
});

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

/**
 * @param {LocalLoadout} next
 * @returns {void}
 */
function commit(next) {
  pickError.value = "";
  emit("update:loadout", next);
}

/**
 * @param {ModRow} row
 * @returns {LocalMod|null}
 */
function chosen(row) {
  return props.loadout.find(row.name);
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
  return chosen(row) !== null;
}

/**
 * @param {ModRow} row
 * @returns {boolean}
 */
function isPinned(row) {
  const local = chosen(row);
  return local !== null && local.pinned;
}

/**
 * @param {ModRow} row
 * @returns {number} the row's place in the load order, -1 when not chosen
 */
function loadIndex(row) {
  return props.loadout.mods.findIndex(mod => mod.name === row.name);
}

/**
 * @param {ModRow} row
 * @param {number} offset
 * @returns {void}
 */
function move(row, offset) {
  commit(props.loadout.withMoved(row.name, offset));
}

/**
 * Checking a mod always means "track the newest version"; one exact version is chosen from the
 * version list instead. Unchecking drops it however it was chosen.
 * @param {ModRow} row
 * @returns {void}
 */
function toggle(row) {
  if (!togglable(row)) {
    return;
  }
  if (chosen(row) !== null) {
    commit(props.loadout.without(row.name));
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
    commit(props.loadout.with(LocalMod.fromListing(row.listing, version, pinned)));
  } catch (error) {
    pickError.value = error.message;
  }
}

/**
 * The versions of this row this client can load, empty for a listing that publishes nothing
 * compatible, and for a base mod nobody has listed.
 * @param {ModRow} row
 * @returns {object[]}
 */
function versionsOf(row) {
  if (row.listing === null) {
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
  return versionsOf(row).length > 0;
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
  const local = chosen(row);
  if (local !== null && local.pinned) {
    return `pinned ${local.version}`;
  }
  if (row.listing === null) {
    return "not published";
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

/**
 * Every version the row has published, newest first; the ones built for another SDK show grayed.
 * @param {ModRow} row
 * @returns {object[]}
 */
function allVersionsOf(row) {
  if (row.listing === null) {
    return [];
  }
  return publishedVersions(row.listing);
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
</script>

<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "ModPicker",
})
</script>

<template>
  <div class="mod-picker">
    <div class="mod-picker-note">This game runs mods built for SDK {{ SDK_VERSION }}.</div>
    <v-text-field
        v-model="search"
        label="Filter"
        autocomplete="off"
        hide-details
        class="my-4"
    />
    <v-chip-group v-model="activeTags" class="mod-picker-tags" column multiple filter>
      <v-chip v-for="tag in allTags" :key="tag" :value="tag" size="small">{{ tag }}</v-chip>
    </v-chip-group>
    <div v-if="pickError" class="mod-picker-error">{{ pickError }}</div>
    <div v-if="error" class="mod-picker-error">{{ error }}</div>
    <v-list class="mod-rows">
      <v-list-item class="mod-row-inert">
        <div class="mod-row-body">
          <div class="mod-row-head">
            <span class="mod-row-name">Built-in mods</span>
          </div>
          <div class="mod-row-desc">{{ builtInDescription }}</div>
        </div>
      </v-list-item>
      <div v-if="loading" class="mod-picker-empty mod-picker-inset">Loading…</div>
      <div v-else-if="shown.length === 0" class="mod-picker-empty mod-picker-inset">No mod matches that filter</div>
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
            <template v-if="loadIndex(row) !== -1">
              <v-btn
                  :icon="mdiArrowUp"
                  aria-label="Load earlier"
                  title="Load earlier"
                  variant="text"
                  size="small"
                  :disabled="loadIndex(row) === 0"
                  @click.stop="move(row, -1)"
              />
              <v-btn
                  :icon="mdiArrowDown"
                  aria-label="Load later"
                  title="Load later"
                  variant="text"
                  size="small"
                  :disabled="loadIndex(row) === loadout.mods.length - 1"
                  @click.stop="move(row, 1)"
              />
            </template>
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
          <div v-if="allVersionsOf(row).length === 0" class="mod-picker-empty">Nothing published yet.</div>
          <v-list v-else class="mod-versions" density="compact" nav>
            <v-list-item
                :active="chosen(row) !== null && !isPinned(row)"
                :disabled="!loadable(row)"
                title="Newest release"
                subtitle="Automatic updates"
                @click="useLatest(row)"
            />
            <v-list-item
                v-for="version in allVersionsOf(row)"
                :key="version.version"
                :active="isPinned(row) && chosen(row).version === version.version"
                :disabled="!versionLoadable(version)"
                :title="version.version"
                :subtitle="versionMeta(version)"
                @click="pick(row, version, true)"
            />
          </v-list>
        </div>
      </div>
    </v-list>
    <div class="mod-picker-actions">
      <v-btn variant="text" size="small" :href="MOD_LISTING_GUIDE_URL" target="_blank" rel="noreferrer">
        Publish a mod
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.mod-picker-note {
  opacity: 0.65;
  font-size: 0.8125rem;
}

.mod-picker-empty {
  opacity: 0.7;
  font-size: 0.875rem;
  margin-top: 12px;
}

.mod-picker-inset {
  padding: 0 16px 12px;
}

.mod-picker-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 12px;
}

.mod-picker-tags {
  margin-bottom: 4px;
}

.mod-picker-actions {
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
