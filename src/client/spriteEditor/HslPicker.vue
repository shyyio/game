<script setup>
import {computed, ref, watch} from "vue";
import {hexToHsl, hslToHex} from "@/client/spriteEditor/color.js";

const props = defineProps({
  modelValue: {type: String, required: true},
});
const emit = defineEmits(["update:modelValue"]);

// Hue and saturation survive a gray or black/white value, which a hex alone cannot carry.
const initial = hexToHsl(props.modelValue);
const h = ref(initial.h);
const s = ref(initial.s);
const l = ref(initial.l);
const hex = computed(() => hslToHex(h.value, s.value, l.value));

watch(() => props.modelValue, value => {
  if (value === hex.value) {
    return;
  }
  const hsl = hexToHsl(value);
  if (hsl.s > 0) {
    h.value = hsl.h;
  }
  if (hsl.l > 0 && hsl.l < 100) {
    s.value = hsl.s;
  }
  l.value = hsl.l;
});

watch(hex, value => {
  if (value !== props.modelValue) {
    emit("update:modelValue", value);
  }
});

// Each track shows what its slider would produce at the other two values.
const hueTrack = "linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))";
const saturationTrack = computed(() => `linear-gradient(to right, hsl(${h.value} 0% ${l.value}%), hsl(${h.value} 100% ${l.value}%))`);
const lightnessTrack = computed(() => `linear-gradient(to right, hsl(${h.value} ${s.value}% 0%), hsl(${h.value} ${s.value}% 50%), hsl(${h.value} ${s.value}% 100%))`);

function onHexInput(event) {
  const value = event.target.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    emit("update:modelValue", value.toLowerCase());
  }
}
</script>

<template>
  <div class="hsl-picker">
    <label class="slider-row">
      <span class="letter">H</span>
      <input v-model.number="h" type="range" class="track" min="0" max="359" :style="{background: hueTrack}">
      <input v-model.number="h" type="number" min="0" max="359">
    </label>
    <label class="slider-row">
      <span class="letter">S</span>
      <input v-model.number="s" type="range" class="track" min="0" max="100" :style="{background: saturationTrack}">
      <input v-model.number="s" type="number" min="0" max="100">
    </label>
    <label class="slider-row">
      <span class="letter">L</span>
      <input v-model.number="l" type="range" class="track" min="0" max="100" :style="{background: lightnessTrack}">
      <input v-model.number="l" type="number" min="0" max="100">
    </label>
    <div class="hex-row">
      <span class="preview" :style="{background: hex}"></span>
      <input :value="hex" type="text" class="hex" maxlength="7" spellcheck="false" @change="onHexInput">
    </div>
  </div>
</template>

<style scoped>
.hsl-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.letter {
  width: 14px;
  opacity: 0.8;
}

.track {
  flex: 1;
  height: 14px;
  margin: 0;
  appearance: none;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.4);
}

.track::-webkit-slider-thumb {
  appearance: none;
  width: 8px;
  height: 18px;
  background: #fff;
  border: 1px solid #000;
  border-radius: 2px;
}

.track::-moz-range-thumb {
  width: 8px;
  height: 18px;
  background: #fff;
  border: 1px solid #000;
  border-radius: 2px;
}

.slider-row input[type="number"] {
  width: 52px;
  font: inherit;
  color: inherit;
  background: #303134;
  border: 1px solid #5f6368;
  border-radius: 4px;
  padding: 2px 4px;
}

.hex-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview {
  width: 22px;
  height: 22px;
  border: 1px solid #5f6368;
  border-radius: 4px;
}

.hex {
  width: 80px;
  font: inherit;
  color: inherit;
  background: #303134;
  border: 1px solid #5f6368;
  border-radius: 4px;
  padding: 2px 4px;
}
</style>
