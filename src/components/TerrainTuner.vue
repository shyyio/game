<script setup>
import {computed, markRaw, reactive, ref, watch} from "vue";
import {DITHER_PATTERNS, activeDither, setActiveDither, setDitherEnabled, ditherOn, setDitherScale, ditherScale} from "@/client/layers/DitherPatterns.js";
import {setBlendLevels, blendLevelCount, setShadeStep, shadeStep, setShadeBand, shadeBand} from "@/client/layers/TerrainSprite.js";
import {setBlendWidth, blendWidth} from "@/common/Terrain.js";
import {Biome, NoiseRange} from "@/common/Biome.js";

const props = defineProps({
  modelValue: {type: Boolean, required: true},
  client: {type: Object, default: null},
});
const emit = defineEmits(["update:modelValue"]);

const open = computed({
  get: () => props.modelValue,
  set: value => emit("update:modelValue", value),
});

const HEX_LENGTH = 6;
const patternNames = DITHER_PATTERNS.map(pattern => pattern.name);

// Frequencies span three decades, so their sliders move in log10 and the field itself is 10^value.
const LOG_BASE = 10;

/**
 * @param {number} color 0xRRGGBB
 * @returns {string} the "#rrggbb" an <input type="color"> takes
 */
function toHex(color) {
  return `#${color.toString(16).padStart(HEX_LENGTH, "0")}`;
}

/**
 * @param {string} hex "#rrggbb"
 * @returns {number} 0xRRGGBB
 */
function fromHex(hex) {
  return Number.parseInt(hex.slice(1), 16);
}

// A biome added here starts as a band this wide around the middle of its channel, so it shows up
// on screen without swallowing the fallback outright.
const NEW_BIOME_MIN = 0.4;
const NEW_BIOME_MAX = 0.6;
const NEW_BIOME_COLOR = 0x8a8f7a;
const NEW_BIOME_PREFIX = "custom-";

// The live objects the controls edit, and the set they formed before the first edit.
const biomes = ref([]);
const channels = ref([]);
const globals = reactive({
  blendLevels: 0,
  blendWidth: 0,
  ditherEnabled: true,
  ditherPattern: "",
  ditherScale: 0,
  shadeStep: 0,
  shadeBand: 0,
});
let defaults = null;

const channelNames = computed(() => channels.value.map(entry => entry.channel.name));
// The loadout's last biome is the unconditional fallback: it takes no ranges and cannot be removed.
const fallback = computed(() => {
  if (biomes.value.length === 0) {
    return null;
  }
  return biomes.value[biomes.value.length - 1].biome;
});

/**
 * @returns {ModRegistry}
 */
function registry() {
  return props.client.modRegistry;
}

/**
 * One biome's controls, over the live Biome and its live NoiseRanges.
 * @param {Biome} biome
 * @returns {object}
 */
function biomeRow(biome) {
  return {
    biome: markRaw(biome),
    color: toHex(biome.color),
    shadeStrength: biome.shadeStrength,
    ranges: biome.ranges.map(range => ({range: markRaw(range), min: range.min, max: range.max})),
  };
}

/**
 * Reads every tunable off the live registry objects into the controls.
 * @returns {void}
 */
function load() {
  biomes.value = registry().biomes.map(biomeRow);
  channels.value = registry().noiseChannels.map(channel => ({
    channel: markRaw(channel),
    frequency: Math.log(channel.frequency) / Math.log(LOG_BASE),
    octaves: channel.octaves,
    lacunarity: channel.lacunarity,
    persistence: channel.persistence,
  }));
  globals.blendLevels = blendLevelCount();
  globals.blendWidth = blendWidth();
  globals.ditherEnabled = ditherOn();
  globals.ditherPattern = activeDither().name;
  globals.ditherScale = Math.log(ditherScale()) / Math.log(LOG_BASE);
  globals.shadeStep = shadeStep();
  globals.shadeBand = shadeBand();
  if (defaults === null) {
    // Structural, not just values: Reset has to put back the biomes and ranges that were removed.
    defaults = {
      biomes: biomes.value.map(entry => ({
        biome: entry.biome,
        name: entry.biome.name,
        color: entry.color,
        shadeStrength: entry.shadeStrength,
        ranges: entry.ranges.map(row => ({
          range: row.range,
          channel: row.range.channel,
          min: row.min,
          max: row.max,
        })),
      })),
      channels: channels.value.map(entry => ({
        channel: entry.channel,
        frequency: entry.channel.frequency,
        octaves: entry.octaves,
        lacunarity: entry.lacunarity,
        persistence: entry.persistence,
      })),
      blendLevels: globals.blendLevels,
      blendWidth: globals.blendWidth,
      ditherEnabled: globals.ditherEnabled,
      ditherPattern: globals.ditherPattern,
      ditherScale: LOG_BASE ** globals.ditherScale,
      shadeStep: globals.shadeStep,
      shadeBand: globals.shadeBand,
    };
  }
}

/**
 * @returns {object} every current value, as plain data
 */
function snapshot() {
  return {
    biomes: biomes.value.map(entry => ({
      name: entry.biome.name,
      color: entry.color,
      shadeStrength: entry.shadeStrength,
      ranges: entry.ranges.map(row => ({channel: row.range.channel.name, min: row.min, max: row.max})),
    })),
    channels: channels.value.map(entry => ({
      name: entry.channel.name,
      frequency: LOG_BASE ** entry.frequency,
      octaves: entry.octaves,
      lacunarity: entry.lacunarity,
      persistence: entry.persistence,
    })),
    blendLevels: globals.blendLevels,
    blendWidth: globals.blendWidth,
    ditherEnabled: globals.ditherEnabled,
    ditherPattern: globals.ditherPattern,
    ditherScale: LOG_BASE ** globals.ditherScale,
    shadeStep: globals.shadeStep,
    shadeBand: globals.shadeBand,
  };
}

// Only the ground's colors changed; the biome each tile belongs to still stands.
function repaint() {
  props.client.repaintTerrain();
}

// A tile's biome may have changed, so every cached bake has to go.
function retune() {
  props.client.retuneTerrain();
}

function applyColor(entry, hex) {
  entry.color = hex;
  entry.biome.color = fromHex(hex);
  repaint();
}

function applyShadeStrength(entry) {
  entry.biome.shadeStrength = entry.shadeStrength;
  repaint();
}

function applyRange(row) {
  // A range with min above max matches nothing at all; keep the pair ordered as it is dragged.
  row.range.min = Math.min(row.min, row.max);
  row.range.max = Math.max(row.min, row.max);
  retune();
}

/**
 * Hands the edited biome list back to the registry, which renumbers it in place, then rebuilds the
 * controls off what it accepted.
 * @returns {void}
 */
function commitBiomes() {
  registry().setBiomes(biomes.value.map(entry => entry.biome));
  load();
  retune();
}

/**
 * @returns {NoiseChannel} the channel a fresh range reads: the loadout's last, the engine's own
 *          shade and dither channels coming first
 */
function defaultChannel() {
  return channels.value[channels.value.length - 1].channel;
}

/**
 * @returns {string} a biome name no biome in the loadout is using
 */
function freeName() {
  const taken = new Set(biomes.value.map(entry => entry.biome.name));
  let index = 1;
  while (taken.has(`${NEW_BIOME_PREFIX}${index}`)) {
    index++;
  }
  return `${NEW_BIOME_PREFIX}${index}`;
}

/**
 * Adds a biome just before the fallback, so the fallback stays last and unconditional. An empty
 * loadout gets an unconditional biome instead, there being nothing for it to fall back to.
 * @returns {void}
 */
function addBiome() {
  const ranges = [];
  if (biomes.value.length > 0) {
    ranges.push(new NoiseRange(defaultChannel(), NEW_BIOME_MIN, NEW_BIOME_MAX));
  }
  const biome = new Biome(freeName(), NEW_BIOME_COLOR, ranges);
  biomes.value.splice(Math.max(0, biomes.value.length - 1), 0, biomeRow(biome));
  commitBiomes();
}

/**
 * @param {object} entry the biome's controls
 * @returns {void}
 */
function removeBiome(entry) {
  biomes.value = biomes.value.filter(candidate => candidate !== entry);
  commitBiomes();
}

/**
 * @param {object} entry the biome's controls
 * @returns {void}
 */
function addRange(entry) {
  const range = markRaw(new NoiseRange(defaultChannel(), NEW_BIOME_MIN, NEW_BIOME_MAX));
  entry.biome.ranges = [...entry.biome.ranges, range];
  entry.ranges.push({range, min: range.min, max: range.max});
  retune();
}

/**
 * @param {object} entry the biome's controls
 * @param {object} row the range's controls
 * @returns {void}
 */
function removeRange(entry, row) {
  entry.biome.ranges = entry.biome.ranges.filter(candidate => candidate !== row.range);
  entry.ranges = entry.ranges.filter(candidate => candidate !== row);
  retune();
}

/**
 * @param {object} row the range's controls
 * @param {string} name the noise channel it should read
 * @returns {void}
 */
function applyRangeChannel(row, name) {
  row.range.channel = channels.value.find(entry => entry.channel.name === name).channel;
  retune();
}

/**
 * Renames a biome, unless another already answers to that name; the registry rejects a duplicate.
 * @param {object} entry the biome's controls
 * @param {string} name
 * @returns {void}
 */
function applyName(entry, name) {
  const clash = biomes.value.some(candidate => candidate !== entry && candidate.biome.name === name);
  if (name === "" || clash) {
    return;
  }
  entry.biome.name = name;
}

function applyChannel(entry) {
  entry.channel.frequency = LOG_BASE ** entry.frequency;
  entry.channel.octaves = entry.octaves;
  entry.channel.lacunarity = entry.lacunarity;
  entry.channel.persistence = entry.persistence;
  retune();
}

function applyBlendLevels() {
  setBlendLevels(globals.blendLevels);
  repaint();
}

function applyBlendWidth() {
  setBlendWidth(globals.blendWidth);
  retune();
}

function applyDither() {
  setDitherEnabled(globals.ditherEnabled);
  setActiveDither(globals.ditherPattern);
  setDitherScale(LOG_BASE ** globals.ditherScale);
  repaint();
}

function applyShade() {
  setShadeStep(globals.shadeStep);
  setShadeBand(globals.shadeBand);
  repaint();
}

/**
 * Puts the whole loadout back where it started, so a tuning session can be abandoned: the biome set
 * and its ranges, not only the values that were dragged.
 * @returns {void}
 */
function reset() {
  for (const entry of defaults.biomes) {
    entry.biome.name = entry.name;
    entry.biome.color = fromHex(entry.color);
    entry.biome.shadeStrength = entry.shadeStrength;
    entry.biome.ranges = entry.ranges.map(row => {
      row.range.channel = row.channel;
      row.range.min = row.min;
      row.range.max = row.max;
      return row.range;
    });
  }
  registry().setBiomes(defaults.biomes.map(entry => entry.biome));
  for (const entry of defaults.channels) {
    entry.channel.frequency = entry.frequency;
    entry.channel.octaves = entry.octaves;
    entry.channel.lacunarity = entry.lacunarity;
    entry.channel.persistence = entry.persistence;
  }
  setBlendLevels(defaults.blendLevels);
  setBlendWidth(defaults.blendWidth);
  setDitherEnabled(defaults.ditherEnabled);
  setActiveDither(defaults.ditherPattern);
  setDitherScale(defaults.ditherScale);
  setShadeStep(defaults.shadeStep);
  setShadeBand(defaults.shadeBand);
  load();
  retune();
}

const copied = ref(false);
const copyLabel = computed(() => {
  if (copied.value) {
    return "Copied";
  }
  return "Copy";
});

/**
 * Copies the tuned numbers, so they can be pasted back into the mod that declares them.
 * @returns {void}
 */
async function copyValues() {
  await navigator.clipboard.writeText(JSON.stringify(snapshot(), null, 2));
  copied.value = true;
  window.setTimeout(() => copied.value = false, 1500);
}

/**
 * @param {number} value
 * @param {number} places
 * @returns {string}
 */
function show(value, places) {
  return value.toFixed(places);
}

// Loaded on open, not on mount: the client arrives asynchronously, and a reopen should show what
// the console helpers may have changed meanwhile.
watch(open, isOpen => {
  if (isOpen && props.client !== null) {
    load();
  }
});
</script>

<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "TerrainTuner",
})
</script>

<template>
  <v-dialog v-model="open" max-width="560" content-class="terrain-tuner" scrollable>
    <v-card>
      <v-toolbar title="Terrain">
        <v-btn variant="text" @click="copyValues">{{ copyLabel }}</v-btn>
        <v-btn variant="text" @click="reset">Reset</v-btn>
        <v-btn variant="text" @click="open = false">Close</v-btn>
      </v-toolbar>
      <v-card-text>
        <div class="tuner-section-title">
          <span>Biomes</span>
          <v-btn size="x-small" variant="tonal" @click="addBiome">Add biome</v-btn>
        </div>
        <div v-for="entry in biomes" :key="entry.biome.name" class="tuner-block">
          <div class="tuner-block-title">
            <input type="color" :value="entry.color" @input="applyColor(entry, $event.target.value)">
            <input
                class="tuner-name"
                type="text"
                :value="entry.biome.name"
                @change="applyName(entry, $event.target.value)"
            >
            <v-btn
                size="x-small" variant="text"
                :disabled="entry.biome === fallback"
                @click="removeBiome(entry)"
            >Remove</v-btn>
          </div>
          <div class="tuner-row">
            <span class="tuner-label">Shade strength</span>
            <v-slider
                v-model="entry.shadeStrength"
                :min="0" :max="3" :step="0.05"
                density="compact" hide-details
                @update:model-value="applyShadeStrength(entry)"
            />
            <span class="tuner-value">{{ show(entry.shadeStrength, 2) }}</span>
          </div>
          <div v-for="(row, rowIndex) in entry.ranges" :key="rowIndex" class="tuner-range">
            <div class="tuner-row">
              <select
                  class="tuner-channel"
                  :value="row.range.channel.name"
                  @change="applyRangeChannel(row, $event.target.value)"
              >
                <option v-for="name in channelNames" :key="name" :value="name">{{ name }}</option>
              </select>
              <v-btn size="x-small" variant="text" @click="removeRange(entry, row)">Drop range</v-btn>
            </div>
            <div class="tuner-row">
              <span class="tuner-label">min</span>
              <v-slider
                  v-model="row.min"
                  :min="0" :max="1" :step="0.005"
                  density="compact" hide-details
                  @update:model-value="applyRange(row)"
              />
              <span class="tuner-value">{{ show(row.min, 3) }}</span>
            </div>
            <div class="tuner-row">
              <span class="tuner-label">max</span>
              <v-slider
                  v-model="row.max"
                  :min="0" :max="1" :step="0.005"
                  density="compact" hide-details
                  @update:model-value="applyRange(row)"
              />
              <span class="tuner-value">{{ show(row.max, 3) }}</span>
            </div>
          </div>
          <div v-if="entry.biome === fallback" class="tuner-note">the fallback biome takes no ranges</div>
          <v-btn v-else size="x-small" variant="text" @click="addRange(entry)">Add range</v-btn>
        </div>

        <div class="tuner-section-title">Noise channels</div>
        <div v-for="entry in channels" :key="entry.channel.name" class="tuner-block">
          <div class="tuner-block-title"><span>{{ entry.channel.name }}</span></div>
          <div class="tuner-row">
            <span class="tuner-label">Frequency</span>
            <v-slider
                v-model="entry.frequency"
                :min="-4" :max="0" :step="0.02"
                density="compact" hide-details
                @update:model-value="applyChannel(entry)"
            />
            <span class="tuner-value">{{ entry.channel.frequency.toPrecision(3) }}</span>
          </div>
          <div class="tuner-row">
            <span class="tuner-label">Octaves</span>
            <v-slider
                v-model="entry.octaves"
                :min="1" :max="6" :step="1"
                density="compact" hide-details
                @update:model-value="applyChannel(entry)"
            />
            <span class="tuner-value">{{ entry.octaves }}</span>
          </div>
          <div class="tuner-row">
            <span class="tuner-label">Lacunarity</span>
            <v-slider
                v-model="entry.lacunarity"
                :min="1" :max="4" :step="0.05"
                density="compact" hide-details
                @update:model-value="applyChannel(entry)"
            />
            <span class="tuner-value">{{ show(entry.lacunarity, 2) }}</span>
          </div>
          <div class="tuner-row">
            <span class="tuner-label">Persistence</span>
            <v-slider
                v-model="entry.persistence"
                :min="0" :max="1" :step="0.01"
                density="compact" hide-details
                @update:model-value="applyChannel(entry)"
            />
            <span class="tuner-value">{{ show(entry.persistence, 2) }}</span>
          </div>
        </div>

        <div class="tuner-section-title">Blending</div>
        <div class="tuner-block">
          <div class="tuner-row">
            <span class="tuner-label">Edge width</span>
            <v-slider
                v-model="globals.blendWidth"
                :min="0.002" :max="0.3" :step="0.002"
                density="compact" hide-details
                @update:model-value="applyBlendWidth"
            />
            <span class="tuner-value">{{ show(globals.blendWidth, 3) }}</span>
          </div>
          <div class="tuner-row">
            <span class="tuner-label">Levels</span>
            <v-slider
                v-model="globals.blendLevels"
                :min="0" :max="16" :step="1"
                density="compact" hide-details
                @update:model-value="applyBlendLevels"
            />
            <span class="tuner-value">{{ globals.blendLevels }}</span>
          </div>
        </div>

        <div class="tuner-section-title">Dithering</div>
        <div class="tuner-block">
          <v-switch
              v-model="globals.ditherEnabled"
              label="Dither the blend"
              color="primary" density="compact" hide-details
              @update:model-value="applyDither"
          />
          <v-select
              v-model="globals.ditherPattern"
              label="Pattern"
              :items="patternNames"
              variant="solo" density="compact" hide-details
              @update:model-value="applyDither"
          />
          <div class="tuner-row">
            <span class="tuner-label">Noise grain</span>
            <v-slider
                v-model="globals.ditherScale"
                :min="-2" :max="1" :step="0.02"
                :disabled="globals.ditherPattern !== 'noise'"
                density="compact" hide-details
                @update:model-value="applyDither"
            />
            <span class="tuner-value">{{ (LOG_BASE ** globals.ditherScale).toPrecision(3) }}</span>
          </div>
        </div>

        <div class="tuner-section-title">Shading</div>
        <div class="tuner-block">
          <div class="tuner-row">
            <span class="tuner-label">Step</span>
            <v-slider
                v-model="globals.shadeStep"
                :min="0" :max="0.15" :step="0.002"
                density="compact" hide-details
                @update:model-value="applyShade"
            />
            <span class="tuner-value">{{ show(globals.shadeStep, 3) }}</span>
          </div>
          <div class="tuner-row">
            <span class="tuner-label">Band</span>
            <v-slider
                v-model="globals.shadeBand"
                :min="0.01" :max="0.5" :step="0.005"
                density="compact" hide-details
                @update:model-value="applyShade"
            />
            <span class="tuner-value">{{ show(globals.shadeBand, 3) }}</span>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style>
.v-dialog > .terrain-tuner {
  margin: max(env(safe-area-inset-top, 0px), 24px)
          max(env(safe-area-inset-right, 0px), 24px)
          max(env(safe-area-inset-bottom, 0px), 24px)
          max(env(safe-area-inset-left, 0px), 24px);
}

.terrain-tuner .tuner-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.875rem;
  font-weight: 500;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 16px 0 4px;
}

.terrain-tuner .tuner-section-title:first-child {
  margin-top: 0;
}

.terrain-tuner .tuner-block {
  padding: 4px 0 8px;
  border-bottom: 1px solid rgb(var(--v-border-color), 0.2);
}

.terrain-tuner .tuner-block-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  padding: 4px 0;
}

.terrain-tuner .tuner-block-title input[type="color"] {
  width: 32px;
  height: 22px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}

.terrain-tuner .tuner-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.terrain-tuner .tuner-label {
  flex: 0 0 120px;
  font-size: 0.8125rem;
  opacity: 0.8;
}

.terrain-tuner .tuner-value {
  flex: 0 0 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
  opacity: 0.8;
}

.terrain-tuner .tuner-name {
  flex: 1 1 auto;
  min-width: 0;
  background: none;
  border: none;
  border-bottom: 1px solid rgb(var(--v-border-color), 0.3);
  color: inherit;
  font: inherit;
  outline: none;
}

.terrain-tuner .tuner-channel {
  flex: 0 0 120px;
  background: none;
  border: 1px solid rgb(var(--v-border-color), 0.3);
  border-radius: 4px;
  color: inherit;
  font-size: 0.8125rem;
  padding: 2px 4px;
}

.terrain-tuner .tuner-channel option {
  color: initial;
}

.terrain-tuner .tuner-note {
  font-size: 0.8125rem;
  opacity: 0.6;
  padding: 2px 0;
}

.terrain-tuner .tuner-range {
  padding-top: 2px;
}
</style>
