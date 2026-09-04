<script setup>
import {computed, onMounted, ref} from "vue";
import {useRouter} from "vue-router";
import {listMods} from "@/client/ModRegistryClient.js";
import {
  LocalLoadout, LocalMod, LOCAL_MOD_SOURCE_URL, refreshLoadout, readLocalLoadout, writeLocalLoadout,
} from "@/client/LocalLoadout.js";
import {LocalConfig, readLocalConfig, writeLocalConfig} from "@/client/LocalConfig.js";
import {hasLocalSave} from "@/client/state/ClientSaveStore.js";
import {DEV_TOOLS} from "@/common/env.js";
import {startError} from "@/client/GameStart.js";
import ModPicker from "@/components/config/ModPicker.vue";
import SeedField from "@/components/config/SeedField.vue";
import TickMsField from "@/components/config/TickMsField.vue";
import ConfigJson from "@/components/config/ConfigJson.vue";

const router = useRouter();

const listings = ref([]);
const loading = ref(true);
const error = ref("");
const localError = ref("");
const loadout = ref(loadStoredLoadout());
const config = ref(loadStoredConfig());
const saved = hasLocalSave();
const url = ref("");
const urlError = ref("");
const adding = ref(false);
// A local game that failed to start comes back here with its reason, since this is where its
// loadout was chosen.
const startFailure = ref(startError.value);
startError.value = "";

onMounted(load);

/**
 * A stored list that no longer parses is reported rather than silently discarded — it is the pin
 * list for code that is about to run.
 * @returns {LocalLoadout}
 */
function loadStoredLoadout() {
  try {
    return readLocalLoadout();
  } catch (storedError) {
    localError.value = `${storedError.message} Uncheck everything to start over.`;
    return new LocalLoadout([]);
  }
}

/**
 * @returns {LocalConfig}
 */
function loadStoredConfig() {
  try {
    return readLocalConfig();
  } catch (storedError) {
    localError.value = storedError.message;
    return LocalConfig.parse({});
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
    listings.value = await listMods();
    commitLoadout(refreshLoadout(loadout.value, listings.value));
  } catch (loadError) {
    listings.value = [];
    error.value = loadError.message;
  }
  loading.value = false;
}

/**
 * @param {LocalLoadout} next
 * @returns {void}
 */
function commitLoadout(next) {
  writeLocalLoadout(next);
  loadout.value = next;
  localError.value = "";
}

/**
 * @param {LocalConfig} next
 * @returns {void}
 */
function commitConfig(next) {
  writeLocalConfig(next);
  config.value = next;
  localError.value = "";
}

/**
 * @param {number|null} seed
 * @returns {void}
 */
function setSeed(seed) {
  try {
    commitConfig(LocalConfig.parse({seed, tickMs: config.value.tickMs}));
  } catch (setError) {
    localError.value = setError.message;
  }
}

/**
 * @param {number} tickMs
 * @returns {void}
 */
function setTickMs(tickMs) {
  try {
    commitConfig(LocalConfig.parse({seed: config.value.seed, tickMs}));
  } catch (setError) {
    localError.value = setError.message;
  }
}

const urlMods = computed(() => loadout.value.mods.filter((mod) => mod.source === LOCAL_MOD_SOURCE_URL));

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
    commitLoadout(loadout.value.with(await LocalMod.fromUrl(url.value.trim())));
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
  commitLoadout(loadout.value.without(name));
}

// Everything on this page as one object, for the text block.
const asJson = computed(() => ({seed: config.value.seed, tickMs: config.value.tickMs, mods: loadout.value.toJSON()}));

/**
 * @param {object} json
 * @returns {void}
 */
function validateJson(json) {
  const {mods, ...rest} = json;
  LocalConfig.parse(rest);
  LocalLoadout.parse(mods);
}

/**
 * @param {object} json already validated
 * @returns {void}
 */
function applyJson(json) {
  const {mods, ...rest} = json;
  commitConfig(LocalConfig.parse(rest));
  commitLoadout(LocalLoadout.parse(mods));
}

function back() {
  router.push({name: "login"});
}
</script>

<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "LocalPlay",
})
</script>

<template>
  <div class="local-play">
    <v-card class="local-play-card" elevation="8">
      <div class="local-play-back">
        <v-btn variant="text" size="small" @click="back">Back</v-btn>
      </div>
      <v-card-title>Local play</v-card-title>
      <v-card-text>
        <div v-if="startFailure" class="local-play-error">The last local game could not start: {{ startFailure }}</div>
        <div v-if="localError" class="local-play-error">{{ localError }}</div>

        <div class="local-play-heading">World</div>
        <div v-if="saved" class="local-play-note">A saved world keeps its seed; a new seed applies to the next new world.</div>
        <SeedField :model-value="config.seed" class="mt-4" @update:model-value="setSeed"/>
        <TickMsField :model-value="config.tickMs" class="mt-4" @update:model-value="setTickMs"/>

        <div class="local-play-section">
          <div class="local-play-heading">Mods</div>
          <ModPicker
              :loadout="loadout"
              :listings="listings"
              :loading="loading"
              :error="error"
              @update:loadout="commitLoadout"
          />
        </div>

        <div v-if="DEV_TOOLS" class="local-play-section">
          <div class="local-play-note">
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
          <div v-if="urlError" class="local-play-error">{{ urlError }}</div>
          <div class="local-play-actions">
            <v-btn size="small" variant="flat" color="primary" :loading="adding" @click="addByUrl">Add</v-btn>
          </div>
        </div>

        <div class="local-play-section">
          <div class="local-play-heading">Settings as text</div>
          <ConfigJson :model-value="asJson" :validate="validateJson" @update:model-value="applyJson"/>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.local-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8vh;
  background: #f5f0e6;
  overflow-y: auto;
}

.local-play-card {
  width: min(94vw, 860px);
  margin-bottom: 32px;
}

/* On a phone the page is the whole screen: a full-bleed sheet, no background showing around it. */
@media (max-width: 600px) {
  .local-play {
    padding-top: 0;
  }

  .local-play-card {
    width: 100%;
    min-height: 100%;
    margin-bottom: 0;
    border-radius: 0;
  }
}

.local-play-back {
  padding: 8px 8px 0;
}

.local-play-note {
  opacity: 0.65;
  font-size: 0.8125rem;
}

.local-play-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 12px;
}

.local-play-heading {
  font-weight: 600;
  margin-bottom: 4px;
}

.local-play-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}

/* The forward action sits rightmost. */
.local-play-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
