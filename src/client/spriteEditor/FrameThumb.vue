<script setup>
import {onMounted, ref, watch} from "vue";

const props = defineProps({
  frame: {type: Object, required: true},
  version: {type: Number, required: true},
  size: {type: Number, default: 48},
});

const canvas = ref(null);

function draw() {
  const {rect, atlas} = props.frame;
  const scale = Math.min(props.size / rect.w, props.size / rect.h, 4);
  const context = canvas.value.getContext("2d");
  canvas.value.width = Math.max(1, Math.round(rect.w * scale));
  canvas.value.height = Math.max(1, Math.round(rect.h * scale));
  context.imageSmoothingEnabled = false;
  context.drawImage(atlas.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.value.width, canvas.value.height);
}

onMounted(draw);
watch(() => [props.version, props.frame, props.size], draw);
</script>

<template>
  <canvas ref="canvas" class="frame-thumb"></canvas>
</template>

<style scoped>
.frame-thumb {
  image-rendering: pixelated;
  background:
      repeating-conic-gradient(#555 0 25%, #444 0 50%) 0 0 / 8px 8px;
}
</style>
