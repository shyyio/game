<script setup>
import {onMounted, ref, computed} from "vue";
import {useRouter} from "vue-router";
import {listMods, MOD_LISTING_GUIDE_URL} from "@/client/ModRegistryClient.js";

const router = useRouter();

const mods = ref([]);
const loading = ref(true);
const error = ref("");
const search = ref("");
const expanded = ref("");
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

const shown = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (term === "") {
    return mods.value;
  }
  return mods.value.filter((mod) => `${mod.name} ${mod.description}`.toLowerCase().includes(term));
});

/**
 * @param {object} mod
 * @returns {void}
 */
function toggle(mod) {
  if (expanded.value === mod.name) {
    expanded.value = "";
    return;
  }
  expanded.value = mod.name;
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

function back() {
  router.back();
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
      <v-card-title>Mods</v-card-title>
      <v-card-subtitle>
        Every listed mod is reviewed and built from public source by the registry. Server operators
        add one by pinning it in their <code>mods.json</code>.
      </v-card-subtitle>
      <v-card-text>
        <v-text-field
            v-model="search"
            label="Search mods"
            density="compact"
            variant="solo"
            hide-details
            clearable
        />
        <div v-if="loading" class="mod-list-empty">Loading…</div>
        <div v-else-if="error" class="mod-list-error">{{ error }}</div>
        <div v-else-if="shown.length === 0" class="mod-list-empty">No mods listed yet</div>
        <div
            v-for="mod in shown"
            :key="mod.name"
            class="mod-row"
            @click="toggle(mod)"
        >
          <div class="mod-row-head">
            <span class="mod-row-name">{{ mod.name }}</span>
            <span class="mod-row-version">{{ mod.latest === null ? "no current version" : mod.latest }}</span>
          </div>
          <div class="mod-row-desc">{{ mod.description }}</div>
          <div v-if="mod.author" class="mod-row-meta">by {{ mod.author }}</div>
          <div v-if="expanded === mod.name" class="mod-row-detail" @click.stop>
            <div class="mod-row-meta">
              <a :href="mod.repo" target="_blank" rel="noreferrer">source</a>
              <template v-if="mod.homepage"> &middot; <a :href="mod.homepage" target="_blank" rel="noreferrer">homepage</a></template>
            </div>
            <table class="mod-row-versions">
              <tr
                  v-for="version in versionsOf(mod)"
                  :key="version.version"
                  :class="{'mod-row-selected': selected?.version === version.version}"
                  @click="select(version)"
              >
                <td>{{ version.version }}</td>
                <td class="mod-row-meta">SDK {{ version.sdkVersion }}</td>
                <td class="mod-row-meta">{{ version.publishedAt }}</td>
                <td class="mod-row-meta">
                  <a :href="`${version.url}mod.json`" target="_blank" rel="noreferrer">manifest</a>
                </td>
              </tr>
            </table>
            <div v-if="selected" class="mod-row-pin">
              <div class="mod-row-meta">Add this to your server's mods.json:</div>
              <pre>{{ lockfileEntry(mod, selected) }}</pre>
              <v-btn size="small" variant="text" @click="copyEntry(mod, selected)">
                {{ copied === mod.name ? "Copied" : "Copy" }}
              </v-btn>
            </div>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="back">Back</v-btn>
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
  width: min(92vw, 560px);
  margin-bottom: 32px;
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

.mod-row {
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  cursor: pointer;
}

.mod-row-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.mod-row-name {
  font-weight: 600;
}

.mod-row-version,
.mod-row-meta {
  opacity: 0.65;
  font-size: 0.8125rem;
}

.mod-row-desc {
  font-size: 0.9375rem;
  opacity: 0.85;
}

.mod-row-detail {
  margin-top: 8px;
  cursor: default;
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

.mod-row-versions tr {
  cursor: pointer;
}

.mod-row-selected {
  background: rgba(0, 0, 0, 0.05);
}

.mod-row-versions {
  width: 100%;
  border-collapse: collapse;
}

.mod-row-versions td {
  padding: 3px 6px 3px 0;
  font-size: 0.8125rem;
}
</style>
