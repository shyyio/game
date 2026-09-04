<script setup>
import {computed, onMounted, ref} from "vue";
import {listMods} from "@/client/ModRegistryClient.js";
import {LocalLoadout, serverLockfile} from "@/client/LocalLoadout.js";
import {ServerConfig, SERVER_CONFIG_FIELDS} from "@/common/ServerConfig.js";
import {ModLockfile} from "@/common/ModLockfile.js";
import {GAME_VERSION, ORIGIN_PATTERN} from "@/common/constants.js";
import {SDK_VERSION} from "@/common/ModManifest.js";
import {
  AdminUnauthorizedError, LoadoutChangeError, convertServerConfig, fetchAdminState, resetServerWorld,
  saveServerConfig, storeAdminToken,
} from "@/client/AdminApiClient.js";
import ModPicker from "@/components/config/ModPicker.vue";
import SeedField from "@/components/config/SeedField.vue";
import TickMsField from "@/components/config/TickMsField.vue";
import ConfigJson from "@/components/config/ConfigJson.vue";

/**
 * One text field of the form.
 */
class Field {

  /**
   * @param {string} key a SERVER_CONFIG_FIELDS entry
   * @param {string} label
   * @param {boolean} numeric
   * @param {string} [hint]
   * @param {Array<function(string): (boolean|string)>} [rules] each returns true or the problem
   */
  constructor(key, label, numeric, hint="", rules=[]) {
    this.key = key;
    this.label = label;
    this.numeric = numeric;
    this.hint = hint;
    this.rules = rules;
  }
}

/**
 * @param {string} value
 * @returns {boolean|string}
 */
function originRule(value) {
  if (ORIGIN_PATTERN.test(value)) {
    return true;
  }
  return "Must be ws://host:port or wss://host:port";
}

const SERVER_FIELDS = [
  new Field("name", "Server name", false, "Shown in the server list"),
  new Field("origin", "Origin", false, "The URL players connect to", [originRule]),
  new Field("authServer", "Auth server", false),
  new Field("host", "Listen address", false),
  new Field("port", "Port", true),
];
const SAVE_FIELDS = [
  new Field("saveMs", "Save interval (ms)", true),
];
const FILE_FIELDS = [
  new Field("db", "World save", false),
  new Field("metricsDb", "Metrics save", false),
  new Field("modsCache", "Mod cache", false),
];

const state = ref(null);
const config = ref(null);
const loadout = ref(new LocalLoadout([]));
const listings = ref([]);
const listingsLoading = ref(true);
const listingsError = ref("");
const error = ref("");
const saving = ref(false);
const savedNote = ref("");
const needsToken = ref(false);
const tokenInput = ref("");
// Whether the next save throws the saved world away, which frees the seed and every mod.
const resetting = ref(false);
const confirmingReset = ref(false);
// What the pending mod change would lose, shown until the operator confirms the conversion.
const losses = ref(null);

onMounted(load);

/**
 * @returns {Promise<void>}
 */
async function load() {
  error.value = "";
  try {
    state.value = await fetchAdminState();
    config.value = state.value.saved;
    needsToken.value = false;
    resetting.value = false;
  } catch (loadError) {
    if (loadError instanceof AdminUnauthorizedError) {
      needsToken.value = true;
      return;
    }
    error.value = loadError.message;
    return;
  }
  listingsLoading.value = true;
  listingsError.value = "";
  try {
    listings.value = await listMods();
  } catch (listError) {
    listings.value = [];
    listingsError.value = listError.message;
  }
  listingsLoading.value = false;
  loadout.value = loadoutOf(config.value);
}

/**
 * Stores the pasted token and loads the page with it.
 * @returns {Promise<void>}
 */
async function signIn() {
  storeAdminToken(tokenInput.value.trim());
  tokenInput.value = "";
  await load();
}

/**
 * The picker's view of a config: its pins, or every base mod when it runs the built-in loadout.
 * @param {object} json a config's public JSON
 * @returns {LocalLoadout}
 */
function loadoutOf(json) {
  if (json.mods === null) {
    return new LocalLoadout([]);
  }
  return LocalLoadout.fromLockfile(ModLockfile.parse({mods: json.mods}), listings.value);
}
const worldLoaded = computed(() => state.value !== null && state.value.world.loaded && !resetting.value);
const lockedSeed = computed(() => {
  if (!worldLoaded.value) {
    return null;
  }
  return state.value.world.seed;
});
const pinnedNote = computed(() => {
  if (state.value === null || state.value.pinned.length === 0) {
    return "";
  }
  return `Set on the command line, not here: ${state.value.pinned.join(", ")}`;
});
const restartNote = computed(() => {
  if (state.value === null) {
    return "";
  }
  const changed = ServerConfig.parse(state.value.saved).diff(ServerConfig.parse(state.value.running))
      .filter(key => !state.value.pinned.includes(key));
  if (changed.length === 0) {
    return "";
  }
  return `Restart the server to apply: ${changed.join(", ")}`;
});

/**
 * @param {Field} field
 * @returns {boolean}
 */
function pinned(field) {
  return state.value.pinned.includes(field.key);
}

/**
 * Where a relative path lands: the config file's directory, shown ahead of the value.
 * @param {Field} field
 * @returns {string}
 */
function pathPrefix(field) {
  const value = fieldText(field);
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    return "";
  }
  return `${state.value.baseDir}/`;
}

/**
 * @param {Field} field
 * @returns {string}
 */
function fieldText(field) {
  const value = config.value[field.key];
  if (value === null) {
    return "";
  }
  return String(value);
}

/**
 * @param {Field} field
 * @param {string} text
 * @returns {void}
 */
function setField(field, text) {
  let value = text;
  if (field.numeric) {
    // An empty box is not zero; NaN so the config refuses it by name instead of taking a port 0.
    value = text.trim() === "" ? Number.NaN : Number(text);
  }
  config.value = Object.assign({}, config.value, {[field.key]: value});
}

/**
 * @param {string} key
 * @param {*} value
 * @returns {void}
 */
function setValue(key, value) {
  config.value = Object.assign({}, config.value, {[key]: value});
}

// The pins this page would save: the picker's choices over the pins the server already has, then
// the base mods it ships, so only a third-party mod ever comes from the registry.
const exported = computed(() => serverLockfile(loadout.value, listings.value, GAME_VERSION, pinnedNow()));

/**
 * @returns {ModLockfile} the config's pins, and behind them the server's own built base mods
 */
function pinnedNow() {
  const entries = [];
  if (config.value.mods !== null) {
    for (const entry of config.value.mods) {
      entries.push(entry);
    }
  }
  if (state.value.builtMods !== null) {
    for (const built of state.value.builtMods) {
      if (!entries.some(entry => entry.name === built.name)) {
        entries.push(built);
      }
    }
  }
  return ModLockfile.parse({mods: entries});
}

// Whether the picker still shows exactly what the config pins, so a built-in loadout stays built in.
const pickerUntouched = computed(() => JSON.stringify(loadoutOf(config.value).toJSON()) === JSON.stringify(loadout.value.toJSON()));

/**
 * @returns {object} the config to save, with the picker's pins in it
 */
function configToSave() {
  if (pickerUntouched.value) {
    return config.value;
  }
  if (exported.value.lockfile === null) {
    throw new Error(missingNote(exported.value.missing));
  }
  return Object.assign({}, config.value, {mods: exported.value.lockfile.mods});
}

/**
 * @param {string[]} names the base mods no package could be found for
 * @returns {string}
 */
function missingNote(names) {
  if (state.value.builtMods === null) {
    return `No built copy of the base mods at ${state.value.distMods}; run "npm run mods:base" there, or start the server with --dist-mods pointing at one, then reload this page`;
  }
  return `No SDK ${SDK_VERSION} package available for ${names.join(", ")}`;
}

const asJson = computed(() => {
  try {
    return configToSave();
  } catch {
    return config.value;
  }
});

/**
 * @param {object} json
 * @returns {void}
 */
function validateJson(json) {
  ServerConfig.parse(json);
}

/**
 * @param {object} json already validated
 * @returns {void}
 */
function applyJson(json) {
  config.value = ServerConfig.parse(json).toPublicJSON();
  loadout.value = loadoutOf(config.value);
}

/**
 * A reset save asks first; a plain save goes straight out.
 * @returns {Promise<void>}
 */
async function save() {
  if (resetting.value) {
    confirmingReset.value = true;
    return;
  }
  await commit(saveServerConfig);
}

/**
 * @returns {Promise<void>}
 */
async function confirmReset() {
  confirmingReset.value = false;
  await commit(resetServerWorld);
}

/**
 * @returns {Promise<void>}
 */
async function confirmConversion() {
  losses.value = null;
  await commit(convertServerConfig);
}

/**
 * @param {Array<{name: string, count: number}>} entries
 * @returns {string}
 */
function lossList(entries) {
  return entries.map(entry => `${entry.count} ${entry.name}`).join(", ");
}

/**
 * Sends the config with the picker's pins in it; everything goes live at once, but for the listen
 * address, which the note names.
 * @param {function(object): Promise<{restart: string[]}>} send
 * @returns {Promise<void>}
 */
async function commit(send) {
  if (saving.value) {
    return;
  }
  error.value = "";
  savedNote.value = "";
  saving.value = true;
  try {
    const {restart} = await send(ServerConfig.parse(configToSave()).toPublicJSON());
    await load();
    if (restart.length === 0) {
      savedNote.value = "Applied";
    } else {
      savedNote.value = `Applied; restart the server for: ${restart.join(", ")}`;
    }
  } catch (saveError) {
    if (saveError instanceof AdminUnauthorizedError) {
      needsToken.value = true;
    } else if (saveError instanceof LoadoutChangeError) {
      losses.value = saveError.losses;
    } else {
      error.value = saveError.message;
    }
  } finally {
    saving.value = false;
  }
}
</script>

<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "AdminApp",
})
</script>

<template>
  <div class="admin">
    <v-card class="admin-card" elevation="8">
      <v-card-title>Server admin</v-card-title>
      <v-card-text v-if="needsToken">
        <div class="admin-note">Paste the admin token from the server's log.</div>
        <v-text-field
            v-model="tokenInput"
            label="Admin token"
            type="password"
            autocomplete="off"
            class="mt-4"
            autofocus
            @keyup.enter="signIn"
        />
        <div class="admin-actions">
          <v-spacer/>
          <v-btn color="primary" variant="flat" :disabled="tokenInput.trim() === ''" @click="signIn">Sign in</v-btn>
        </div>
      </v-card-text>
      <v-card-text v-else-if="config === null">
        <div v-if="error" class="admin-error">{{ error }}</div>
        <div v-else class="admin-note">Loading…</div>
      </v-card-text>
      <v-card-text v-else>
        <div v-if="pinnedNote" class="admin-note admin-banner">{{ pinnedNote }}</div>
        <div v-if="restartNote" class="admin-note admin-banner">{{ restartNote }}</div>

        <div class="admin-heading">Server</div>
        <v-text-field
            v-for="field in SERVER_FIELDS"
            :key="field.key"
            :model-value="fieldText(field)"
            :label="field.label"
            :hint="field.hint"
            :persistent-hint="field.hint !== ''"
            :rules="field.rules"
            validate-on="input"
            :disabled="pinned(field)"
            autocomplete="off"
            class="mt-4"
            @update:model-value="setField(field, $event)"
        />

        <div class="admin-section">
          <div class="admin-heading">World</div>
          <div v-if="state.world.loaded" class="admin-reset">
            <div v-if="resetting" class="admin-note">Saving will delete the saved world and start a new one.</div>
            <div v-else class="admin-note">A saved world keeps its seed.</div>
            <v-btn v-if="resetting" variant="text" size="small" @click="resetting = false">Keep world</v-btn>
            <v-btn v-else variant="text" size="small" @click="resetting = true">Reset world</v-btn>
          </div>
          <SeedField
              :model-value="config.seed"
              :locked-to="lockedSeed"
              class="mt-4"
              @update:model-value="setValue('seed', $event)"
          />
          <TickMsField
              :model-value="config.tickMs"
              :disabled="state.pinned.includes('tickMs')"
              class="mt-4"
              @update:model-value="setValue('tickMs', $event)"
          />
          <v-text-field
              v-for="field in SAVE_FIELDS"
              :key="field.key"
              :model-value="fieldText(field)"
              :label="field.label"
              :disabled="pinned(field)"
              autocomplete="off"
              class="mt-4"
              @update:model-value="setField(field, $event)"
          />
        </div>

        <div class="admin-section">
          <div class="admin-heading">Files</div>
          <v-text-field
              v-for="field in FILE_FIELDS"
              :key="field.key"
              :model-value="fieldText(field)"
              :label="field.label"
              :prefix="pathPrefix(field)"
              :hint="field.hint"
              :persistent-hint="field.hint !== ''"
              :disabled="pinned(field)"
              autocomplete="off"
              class="mt-4"
              @update:model-value="setField(field, $event)"
          />
        </div>

        <div class="admin-section">
          <div class="admin-heading">Mods</div>
          <ModPicker
              :loadout="loadout"
              :listings="listings"
              :loading="listingsLoading"
              :error="listingsError"
              built-in-description="Shipped with this server"
              @update:loadout="loadout = $event"
          />
          <div v-if="!pickerUntouched && exported.missing.length > 0" class="admin-error">
            {{ missingNote(exported.missing) }}
          </div>
        </div>

        <div class="admin-section">
          <div class="admin-heading">Settings as text</div>
          <ConfigJson :model-value="asJson" :validate="validateJson" @update:model-value="applyJson"/>
        </div>

        <div v-if="error" class="admin-error">{{ error }}</div>
        <div class="admin-actions">
          <span v-if="savedNote" class="admin-note">{{ savedNote }}</span>
          <v-spacer/>
          <v-btn color="primary" variant="flat" :loading="saving" @click="save">
            {{ resetting ? "Reset world and confirm" : "Confirm" }}
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
    <v-dialog :model-value="losses !== null" max-width="480" @update:model-value="losses = null">
      <v-card v-if="losses !== null">
        <v-card-title>Convert the world?</v-card-title>
        <v-card-text>
          <div>The world carries over to the new mods, but this is lost:</div>
          <div v-if="losses.objects.length > 0" class="mt-2">Objects: {{ lossList(losses.objects) }}</div>
          <div v-if="losses.items.length > 0" class="mt-2">Items: {{ lossList(losses.items) }}</div>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="losses = null">Cancel</v-btn>
          <v-spacer/>
          <v-btn color="primary" variant="flat" @click="confirmConversion">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="confirmingReset" max-width="420">
      <v-card>
        <v-card-title>Delete the saved world?</v-card-title>
        <v-card-text>Every player's factory is lost. The server starts a new world with these settings.</v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="confirmingReset = false">Cancel</v-btn>
          <v-spacer/>
          <v-btn color="primary" variant="flat" @click="confirmReset">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.admin {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8vh;
  background: #f5f0e6;
  overflow-y: auto;
}

.admin-card {
  width: min(94vw, 860px);
  margin-bottom: 32px;
}

.admin-note {
  opacity: 0.65;
  font-size: 0.8125rem;
}

.admin-banner {
  opacity: 0.85;
  margin-bottom: 12px;
}

.admin-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 12px;
}

.admin-heading {
  font-weight: 600;
  margin-bottom: 4px;
}

.admin-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}

.admin-reset {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* The forward action sits rightmost. */
.admin-actions {
  display: flex;
  align-items: center;
  margin-top: 24px;
}
</style>
