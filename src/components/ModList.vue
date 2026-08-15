<script setup>
import {onMounted, ref, computed} from "vue";
import {useRouter} from "vue-router";
import {listMods, tagsOf, displayNameOf, MOD_TAGS, MOD_LISTING_GUIDE_URL} from "@/client/ModRegistryClient.js";
import {formatPastDate} from "@/common/dateFormat.js";

const router = useRouter();

const mods = ref([]);
const loading = ref(true);
const error = ref("");
const search = ref("");
const activeTags = ref([]);
const expanded = ref(null);
const selected = ref(null);
const copied = ref("");

onMounted(load);

/**
 * @returns {Promise<void>}
 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    mods.value = await listMods();
  } catch (loadError) {
    mods.value = [];
    error.value = loadError.message;
  }
  loading.value = false;
}

// Every tag any listed mod carries, in the order tags sort in — the filter row only offers tags
// that can actually match something.
const allTags = computed(() => {
  const tags = new Set();
  for (const mod of mods.value) {
    for (const tag of tagsOf(mod)) {
      tags.add(tag);
    }
  }
  return [...tags].sort((left, right) => MOD_TAGS.indexOf(left) - MOD_TAGS.indexOf(right));
});

const shown = computed(() => {
  const term = search.value === null ? "" : search.value.trim().toLowerCase();
  return mods.value.filter((mod) => {
    const tags = tagsOf(mod);
    if (!activeTags.value.every((tag) => tags.includes(tag))) {
      return false;
    }
    if (term === "") {
      return true;
    }
    return `${displayNameOf(mod)} ${mod.name} ${mod.description} ${tags.join(" ")}`.toLowerCase().includes(term);
  });
});

/**
 * Opening a panel starts on the mod's newest version.
 * @param {string|null} name the panel now open, if any
 * @returns {void}
 */
function onExpand(name) {
  expanded.value = name;
  if (name === null || name === undefined) {
    selected.value = null;
    return;
  }
  const mod = mods.value.find((candidate) => candidate.name === name);
  selected.value = versionsOf(mod)[0];
}

/**
 * @param {object} version
 * @returns {void}
 */
function select(version) {
  selected.value = version;
}

/**
 * The entry an operator pastes into their server's mods.json — the same shape `mods add` would
 * write, pinned to this exact version's files.
 * @param {object} mod
 * @param {object} version
 * @returns {string}
 */
function lockfileEntry(mod, version) {
  return JSON.stringify({
    url: version.url,
    name: mod.name,
    version: version.version,
    integrity: version.artifacts,
  }, null, 4);
}

/**
 * @param {object} mod
 * @param {object} version
 * @returns {Promise<void>}
 */
async function copyEntry(mod, version) {
  await navigator.clipboard.writeText(lockfileEntry(mod, version));
  copied.value = mod.name;
  setTimeout(() => {
    if (copied.value === mod.name) {
      copied.value = "";
    }
  }, 1500);
}

/**
 * @param {object} mod
 * @returns {object[]} newest first
 */
function versionsOf(mod) {
  return [...mod.versions].reverse();
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
        <v-text-field
            v-model="search"
            label="Search"
            autocomplete="off"
            hide-details
            class="my-4"
        />
        <v-chip-group v-model="activeTags" class="mod-list-tags" column multiple filter>
          <v-chip v-for="tag in allTags" :key="tag" :value="tag" size="small">{{ tag }}</v-chip>
        </v-chip-group>
        <div v-if="loading" class="mod-list-empty">Loading…</div>
        <div v-else-if="error" class="mod-list-error">{{ error }}</div>
        <div v-else-if="shown.length === 0" class="mod-list-empty">No mods listed yet</div>
        <v-expansion-panels v-else :model-value="expanded" variant="accordion" @update:model-value="onExpand">
          <v-expansion-panel v-for="mod in shown" :key="mod.name" :value="mod.name">
            <v-expansion-panel-title>
              <div class="mod-row">
                <div class="mod-row-head">
                  <span class="mod-row-name">{{ displayNameOf(mod) }}</span>
                  <span class="mod-row-meta">{{ mod.latest === null ? "no current version" : mod.latest }}</span>
                  <v-chip
                      v-for="tag in tagsOf(mod)"
                      :key="tag"
                      size="x-small"
                      variant="tonal"
                      @click.stop="activeTags = [tag]"
                  >{{ tag }}</v-chip>
                </div>
                <div class="mod-row-desc">{{ mod.description }}</div>
                <div v-if="mod.author" class="mod-row-meta">{{ mod.author }}</div>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="mod-row-meta">
                <a :href="mod.repo" target="_blank" rel="noreferrer">source</a>
                <template v-if="mod.homepage"> &middot; <a :href="mod.homepage" target="_blank" rel="noreferrer">homepage</a></template>
              </div>
              <v-list class="mod-versions" density="compact" nav>
                <v-list-item
                    v-for="version in versionsOf(mod)"
                    :key="version.version"
                    :active="selected?.version === version.version"
                    :title="version.version"
                    :subtitle="versionMeta(version)"
                    @click="select(version)"
                />
              </v-list>
              <div v-if="selected" class="mod-row-pin">
                <div class="mod-row-meta">Add this to your server's mods.json:</div>
                <pre>{{ lockfileEntry(mod, selected) }}</pre>
                <v-btn size="small" variant="text" @click="copyEntry(mod, selected)">
                  {{ copied === mod.name ? "Copied" : "Copy" }}
                </v-btn>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
      <v-card-actions>
        <v-spacer/>
        <v-btn variant="text" :href="MOD_LISTING_GUIDE_URL" target="_blank" rel="noreferrer">Publish a mod</v-btn>
      </v-card-actions>
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

.mod-row {
  min-width: 0;
}

.mod-row-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
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

.mod-row-pin {
  margin: 8px 0 4px;
}

.mod-row-pin pre {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 4px 0;
  font-size: 0.75rem;
  overflow-x: auto;
}

.mod-versions {
  padding: 4px 0;
  background: transparent;
}
</style>
