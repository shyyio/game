<script setup>
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from "vue";
import FrameThumb from "@/client/spriteEditor/FrameThumb.vue";
import HslPicker from "@/client/spriteEditor/HslPicker.vue";
import {
  NO_TINT_HEX, SOURCE_BLOCK, TOOL_ERASER, TOOL_EYEDROPPER, TOOL_FILL, TOOL_LINE, TOOL_PENCIL,
  TOOL_RECT,
} from "@/client/spriteEditor/SpriteEditorSession.js";
import {applyTint, fromHex} from "@/client/spriteEditor/PixelOps.js";

// Eraser cursor: a tilted block with its wiping edge at the hotspot (bottom-left).
const ERASER_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
    + `<path d="M3 20 L13 10 L20 17 L14 23 Z" fill="#f28b82" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<path d="M13 10 L19 4 L26 11 L20 17 Z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>`
    + `</svg>`;
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ERASER_CURSOR_SVG)}") 3 22, auto`;

const props = defineProps({
  session: {type: Object, required: true},
});

const state = props.session.state;
const root = ref(null);
const scroll = ref(null);
const canvas = ref(null);
const previewCanvas = ref(null);

const TOOLS = [
  {id: TOOL_PENCIL, label: "Pencil", key: "p"},
  {id: TOOL_ERASER, label: "Eraser", key: "e"},
  {id: TOOL_EYEDROPPER, label: "Pick", key: "i"},
  {id: TOOL_FILL, label: "Fill", key: "g"},
  {id: TOOL_LINE, label: "Line", key: "l"},
  {id: TOOL_RECT, label: "Rect", key: "r"},
];
const ZOOM_MIN = 2;
const ZOOM_MAX = 48;
const ZOOM_WHEEL_STEP = 0.2;
const PLAY_INTERVAL_MS = 120;
const PREVIEW_SCALE = 3;

const frame = computed(() => {
  // Read the reactive name so the getter re-evaluates on selection.
  void state.frameName;
  return props.session.frame;
});
const sequence = computed(() => {
  void state.frameName;
  return props.session.sequence;
});
const atlases = computed(() => [...props.session.textureRegistry.atlases.values()]);
// The picked tint as pixi takes it in code.
const tintValue = computed(() => `0x${state.tintHex.slice(1).toUpperCase()}`);

const groups = computed(() => {
  const filter = state.filter.trim().toLowerCase();
  const byGroup = new Map();
  for (const entry of props.session.frames) {
    if (filter !== "" && !entry.name.toLowerCase().includes(filter)) {
      continue;
    }
    if (!byGroup.has(entry.group)) {
      byGroup.set(entry.group, []);
    }
    byGroup.get(entry.group).push(entry);
  }
  return [...byGroup.entries()].map(([name, frames]) => ({name, frames}));
});

function select(name) {
  props.session.select(name);
}

function pixelAt(event) {
  const bounds = canvas.value.getBoundingClientRect();
  return [
    Math.floor((event.clientX - bounds.left) / state.zoom),
    Math.floor((event.clientY - bounds.top) / state.zoom),
  ];
}

let painting = false;
// Ctrl (or Cmd) held: the next click picks a color, so the canvas shows the picker's crosshair.
const modifierHeld = ref(false);
const panning = ref(false);
const canvasCursor = computed(() => {
  if (panning.value) {
    return "grabbing";
  }
  if (state.tool === TOOL_EYEDROPPER || modifierHeld.value) {
    return "crosshair";
  }
  if (state.tool === TOOL_ERASER) {
    return ERASER_CURSOR;
  }
  return "default";
});

function onModifierKey(event) {
  modifierHeld.value = event.ctrlKey || event.metaKey;
}

function onWindowBlur() {
  modifierHeld.value = false;
}

// The editor's window; template refs are already cleared by the time onUnmounted runs.
let view = null;

function onPointerDown(event) {
  if (frame.value === null) {
    return;
  }
  if (event.button !== 0) {
    // Middle/right buttons pan; the scroll container handles them.
    return;
  }
  root.value.focus({preventScroll: true});
  const [x, y] = pixelAt(event);
  if (event.ctrlKey || event.metaKey) {
    // Ctrl-click picks a color with any tool.
    const tool = state.tool;
    state.tool = TOOL_EYEDROPPER;
    props.session.beginStroke(x, y);
    state.tool = tool;
    return;
  }
  canvas.value.setPointerCapture(event.pointerId);
  painting = true;
  props.session.beginStroke(x, y);
}

function onPointerMove(event) {
  if (!painting) {
    return;
  }
  const [x, y] = pixelAt(event);
  props.session.moveStroke(x, y);
}

function onPointerUp() {
  if (!painting) {
    return;
  }
  painting = false;
  props.session.endStroke();
}

let pan = null;

function onPanDown(event) {
  if (event.button !== 1 && event.button !== 2) {
    return;
  }
  event.preventDefault();
  const element = scroll.value;
  element.setPointerCapture(event.pointerId);
  pan = {x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop};
  panning.value = true;
}

function onPanMove(event) {
  if (pan === null) {
    return;
  }
  scroll.value.scrollLeft = pan.left - (event.clientX - pan.x);
  scroll.value.scrollTop = pan.top - (event.clientY - pan.y);
}

function onPanUp() {
  pan = null;
  panning.value = false;
}

async function onWheel(event) {
  if (frame.value === null) {
    return;
  }
  event.preventDefault();
  const step = Math.max(1, Math.round(state.zoom * ZOOM_WHEEL_STEP));
  let zoom;
  if (event.deltaY < 0) {
    zoom = Math.min(ZOOM_MAX, state.zoom + step);
  } else {
    zoom = Math.max(ZOOM_MIN, state.zoom - step);
  }
  if (zoom === state.zoom) {
    return;
  }
  // Keep the frame pixel under the cursor where it is.
  const element = scroll.value;
  const bounds = canvas.value.getBoundingClientRect();
  const px = (event.clientX - bounds.left) / state.zoom;
  const py = (event.clientY - bounds.top) / state.zoom;
  const originX = bounds.left + element.scrollLeft - element.getBoundingClientRect().left;
  const originY = bounds.top + element.scrollTop - element.getBoundingClientRect().top;
  state.zoom = zoom;
  await nextTick();
  element.scrollLeft = originX + px * zoom - (event.clientX - element.getBoundingClientRect().left);
  element.scrollTop = originY + py * zoom - (event.clientY - element.getBoundingClientRect().top);
}

function onKeyDown(event) {
  const target = event.target;
  if (target.tagName === "INPUT" && (target.type === "text" || target.type === "number")) {
    return;
  }
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    if (event.shiftKey) {
      props.session.redo();
    } else {
      props.session.undo();
    }
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "y") {
    props.session.redo();
    event.preventDefault();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const tool = TOOLS.find(t => t.key === key);
  if (tool !== undefined) {
    state.tool = tool.id;
  } else if (key === "[") {
    state.zoom = Math.max(ZOOM_MIN, state.zoom - 1);
  } else if (key === "]") {
    state.zoom = Math.min(ZOOM_MAX, state.zoom + 1);
  } else if (key === "x") {
    state.grid = !state.grid;
  } else if (key === "o") {
    state.onion = !state.onion;
  } else if (key === " ") {
    state.playing = !state.playing;
    event.preventDefault();
  } else if (key === "," || key === ".") {
    stepSequence(key === "," ? -1 : 1);
  }
}

function stepSequence(delta) {
  const frames = sequence.value;
  if (frames.length === 0) {
    return;
  }
  const index = frames.indexOf(frame.value);
  select(frames[(index + delta + frames.length) % frames.length].name);
}

// Scratch canvas for the tint pass: the frame multiplies at native size, then scales up.
let tintCanvas = null;

/**
 * The frame's pixels under the picked tint, at native size.
 */
function tintedFrame(entry) {
  const {rect, atlas} = entry;
  if (tintCanvas === null) {
    tintCanvas = root.value.ownerDocument.createElement("canvas");
  }
  tintCanvas.width = rect.w;
  tintCanvas.height = rect.h;
  const context = tintCanvas.getContext("2d", {willReadFrequently: true});
  context.drawImage(atlas.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const pixels = context.getImageData(0, 0, rect.w, rect.h);
  applyTint(pixels, fromHex(state.tintHex, 255));
  context.putImageData(pixels, 0, 0);
  return tintCanvas;
}

/**
 * Draws one frame, tinted when a tint is picked, scaled to fill the target context.
 */
function blit(context, entry, width, height) {
  const {rect, atlas} = entry;
  if (state.tintHex === NO_TINT_HEX) {
    context.drawImage(atlas.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
    return;
  }
  context.drawImage(tintedFrame(entry), 0, 0, rect.w, rect.h, 0, 0, width, height);
}

function draw() {
  const current = frame.value;
  const element = canvas.value;
  if (current === null || element === null) {
    return;
  }
  const {rect} = current;
  const zoom = state.zoom;
  element.width = rect.w * zoom;
  element.height = rect.h * zoom;
  const context = element.getContext("2d");
  context.imageSmoothingEnabled = false;
  if (state.onion) {
    const frames = sequence.value;
    const index = frames.indexOf(current);
    if (frames.length > 1) {
      const previous = frames[(index - 1 + frames.length) % frames.length];
      context.globalAlpha = 0.35;
      blit(context, previous, element.width, element.height);
      context.globalAlpha = 1;
    }
  }
  blit(context, current, element.width, element.height);
  const step = SOURCE_BLOCK * zoom;
  if (state.grid && step >= 4) {
    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = step; x < element.width; x += step) {
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, element.height);
    }
    for (let y = step; y < element.height; y += step) {
      context.moveTo(0, y + 0.5);
      context.lineTo(element.width, y + 0.5);
    }
    context.stroke();
  }
}

function drawPreview() {
  const element = previewCanvas.value;
  const frames = sequence.value;
  if (element === null || frames.length === 0) {
    return;
  }
  const shown = frames[state.playIndex % frames.length];
  element.width = shown.rect.w * PREVIEW_SCALE;
  element.height = shown.rect.h * PREVIEW_SCALE;
  const context = element.getContext("2d");
  context.imageSmoothingEnabled = false;
  blit(context, shown, element.width, element.height);
}

let playTimer = null;

function syncPlayback() {
  if (playTimer !== null) {
    view.clearInterval(playTimer);
    playTimer = null;
  }
  // The editor window's own timer: the opener's is throttled while the game window is covered.
  if (view !== null && state.playing && sequence.value.length > 1) {
    playTimer = view.setInterval(() => {
      state.playIndex = (state.playIndex + 1) % sequence.value.length;
    }, PLAY_INTERVAL_MS);
  }
}

watch(() => [state.paintVersion, state.zoom, state.grid, state.onion, state.frameName, state.tintHex], draw, {flush: "post"});
watch(() => [state.paintVersion, state.playIndex, state.frameName, state.tintHex], drawPreview, {flush: "post"});
watch(() => [state.playing, state.frameName], syncPlayback);

onMounted(() => {
  view = root.value.ownerDocument.defaultView;
  // Capture phase: the root stops keydown propagation to keep game hotkeys out.
  view.addEventListener("keydown", onModifierKey, true);
  view.addEventListener("keyup", onModifierKey, true);
  view.addEventListener("blur", onWindowBlur);
  if (state.frameName === null && props.session.frames.length > 0) {
    select(props.session.frames[0].name);
  }
  draw();
  drawPreview();
  syncPlayback();
  root.value.focus({preventScroll: true});
});

onUnmounted(() => {
  view.removeEventListener("keydown", onModifierKey, true);
  view.removeEventListener("keyup", onModifierKey, true);
  view.removeEventListener("blur", onWindowBlur);
  if (playTimer !== null) {
    view.clearInterval(playTimer);
  }
  props.session.flushPersist();
});

function pickSwatch(swatch) {
  state.colorHex = swatch.hex;
  state.alpha = swatch.alpha;
}

function downloadBlob(blob, filename) {
  const doc = root.value.ownerDocument;
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadPng(atlas) {
  downloadBlob(await props.session.atlasPng(atlas.name), atlas.sheetData.meta.image);
}

async function downloadFrame() {
  downloadBlob(await props.session.framePng(), `${state.frameName.replaceAll("/", "_")}.png`);
}

async function importPng(atlas, event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (file === undefined) {
    return;
  }
  try {
    await props.session.importAtlas(atlas.name, file);
  } catch (error) {
    root.value.ownerDocument.defaultView.alert(error.message);
  }
}

function confirmIn(message) {
  return root.value.ownerDocument.defaultView.confirm(message);
}

async function resetFrame() {
  if (confirmIn(`Restore "${state.frameName}" to the shipped art?`)) {
    await props.session.resetFrame();
  }
}

async function resetAll() {
  if (confirmIn("Forget every edit and restore the shipped art?")) {
    await props.session.resetAll();
  }
}
</script>

<template>
  <div ref="root" class="sprite-editor" tabindex="0" @keydown.stop="onKeyDown" @contextmenu.prevent>
    <div class="frames">
      <input v-model="state.filter" type="text" class="filter" placeholder="Filter frames">
      <div class="frame-list">
        <template v-for="group in groups" :key="group.name">
          <div class="group-title">{{ group.name || "(root)" }}</div>
          <button
              v-for="entry in group.frames"
              :key="entry.name"
              class="frame-item"
              :class="{selected: entry.name === state.frameName}"
              :title="entry.name"
              @click="select(entry.name)"
          >
            <FrameThumb :frame="entry" :version="state.commitVersion" :size="36"/>
            <span class="frame-name">{{ entry.name.slice(entry.group.length + (entry.group ? 1 : 0)) }}</span>
          </button>
        </template>
      </div>
    </div>

    <div class="workspace">
      <div class="toolbar">
        <button
            v-for="tool in TOOLS"
            :key="tool.id"
            class="tool"
            :class="{active: state.tool === tool.id}"
            :title="`${tool.label} (${tool.key})`"
            @click="state.tool = tool.id"
        >{{ tool.label }}</button>
        <span class="spacer"></span>
        <button :disabled="!state.canUndo" title="Undo (Ctrl+Z)" @click="session.undo()">Undo</button>
        <button :disabled="!state.canRedo" title="Redo (Ctrl+Y)" @click="session.redo()">Redo</button>
        <span class="spacer"></span>
        <label>Zoom <input v-model.number="state.zoom" type="range" :min="ZOOM_MIN" :max="ZOOM_MAX"></label>
        <label><input v-model="state.grid" type="checkbox"> Grid</label>
        <label><input v-model="state.onion" type="checkbox" :disabled="sequence.length < 2"> Onion</label>
      </div>
      <div
          ref="scroll"
          class="canvas-scroll"
          :style="{cursor: panning ? 'grabbing' : 'default'}"
          @pointerdown="onPanDown"
          @pointermove="onPanMove"
          @pointerup="onPanUp"
          @pointercancel="onPanUp"
          @mousedown.prevent
          @wheel="onWheel"
      >
        <div v-if="frame !== null" class="canvas-pad">
          <canvas
              ref="canvas"
              class="paint"
              :style="{cursor: canvasCursor}"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
          ></canvas>
        </div>
        <div v-else class="empty">No paintable frames</div>
      </div>
      <div class="status">
        <span v-if="frame !== null">{{ frame.name }} · {{ frame.rect.w }}×{{ frame.rect.h }} · {{ frame.atlas.name }}</span>
      </div>
    </div>

    <div class="side">
      <section>
        <div class="section-title">Color</div>
        <HslPicker v-model="state.colorHex"/>
        <div class="color-row">
          <label>Alpha <input v-model.number="state.alpha" type="range" min="0" max="255"></label>
        </div>
        <div class="palette">
          <button
              v-for="swatch in state.palette"
              :key="swatch.hex + swatch.alpha"
              class="swatch"
              :style="{background: swatch.hex, opacity: swatch.alpha / 255}"
              :title="`${swatch.hex} α${swatch.alpha}`"
              @click="pickSwatch(swatch)"
          ></button>
        </div>
      </section>

      <section>
        <div class="section-title">Tint</div>
        <HslPicker v-model="state.tintHex"/>
        <div class="row tint-row">
          <span class="tint-swatch" :style="{background: state.tintHex}"></span>
          <code class="tint-value">{{ tintValue }}</code>
          <button :disabled="state.tintHex === NO_TINT_HEX" @click="state.tintHex = NO_TINT_HEX">Clear</button>
        </div>
      </section>

      <section v-if="sequence.length > 1">
        <div class="section-title">Animation</div>
        <div class="strip">
          <button
              v-for="entry in sequence"
              :key="entry.name"
              class="strip-item"
              :class="{selected: entry.name === state.frameName}"
              @click="select(entry.name)"
          >
            <FrameThumb :frame="entry" :version="state.commitVersion" :size="28"/>
          </button>
        </div>
        <div class="preview-row">
          <canvas ref="previewCanvas" class="preview"></canvas>
          <button @click="state.playing = !state.playing">{{ state.playing ? "Pause" : "Play" }}</button>
        </div>
      </section>

      <section>
        <div class="section-title">Frame</div>
        <div class="row">
          <button :disabled="frame === null" title="Download this frame at source (1x) size" @click="downloadFrame">Save</button>
          <button :disabled="frame === null" @click="resetFrame">Reset</button>
        </div>
      </section>

      <section>
        <div class="section-title">Sheets</div>
        <div v-for="atlas in atlases" :key="atlas.name" class="atlas-row">
          <span class="atlas-name">{{ atlas.sheetData.meta.image }}</span>
          <button title="Download the edited sheet" @click="downloadPng(atlas)">Save</button>
          <label class="file-button">Load<input type="file" accept="image/png" @change="importPng(atlas, $event)"></label>
        </div>
      </section>

      <section>
        <div class="row">
          <button class="danger" @click="resetAll">Reset everything</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sprite-editor {
  display: flex;
  width: 100%;
  height: 100%;
  background: #202124;
  color: #e8eaed;
  font: 15px/1.4 system-ui, sans-serif;
  outline: none;
  user-select: none;
}

.sprite-editor button,
.sprite-editor select,
.sprite-editor input[type="text"] {
  font: inherit;
  color: inherit;
  background: #303134;
  border: 1px solid #5f6368;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
}

.sprite-editor input[type="text"] {
  cursor: text;
}

.sprite-editor button:disabled {
  opacity: 0.4;
  cursor: default;
}

.sprite-editor button.active,
.sprite-editor button.selected {
  background: #1a73e8;
  border-color: #1a73e8;
}

.sprite-editor button.danger {
  border-color: #d93025;
}

.frames {
  display: flex;
  flex-direction: column;
  width: 220px;
  min-width: 220px;
  border-right: 1px solid #3c4043;
}

.filter {
  margin: 8px;
}

.frame-list {
  overflow-y: auto;
  flex: 1;
  padding: 0 8px 8px;
}

.group-title {
  margin: 8px 0 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
}

.frame-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 2px;
  text-align: left;
}

.frame-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid #3c4043;
  flex-wrap: wrap;
}

.toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.spacer {
  width: 12px;
}

.canvas-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* Room to pan past the frame on every side; scroll content, so it never widens the layout. */
.canvas-pad {
  display: inline-block;
  padding: 40vh 40vw;
}

.paint {
  display: block;
  image-rendering: pixelated;
  touch-action: none;
  background: repeating-conic-gradient(#555 0 25%, #444 0 50%) 0 0 / 16px 16px;
}

.empty {
  padding: 16px;
  opacity: 0.6;
}

.status {
  padding: 4px 8px;
  border-top: 1px solid #3c4043;
  font-size: 12px;
  opacity: 0.8;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 280px;
  min-width: 280px;
  padding: 8px;
  border-left: 1px solid #3c4043;
  overflow-y: auto;
  overflow-x: hidden;
}

.section-title {
  margin-bottom: 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.color-row label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.color-row input[type="range"] {
  flex: 1;
}

.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 6px;
  background: repeating-conic-gradient(#555 0 25%, #444 0 50%) 0 0 / 8px 8px;
  padding: 3px;
}

.swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.4);
}

.tint-row {
  margin-top: 6px;
}

.tint-swatch {
  width: 20px;
  height: 20px;
  border: 1px solid rgba(0, 0, 0, 0.4);
}

.tint-value {
  flex: 1;
  font-family: ui-monospace, monospace;
}

.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.strip-item {
  padding: 2px;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.preview {
  image-rendering: pixelated;
  background: repeating-conic-gradient(#555 0 25%, #444 0 50%) 0 0 / 8px 8px;
}

.atlas-row,
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.atlas-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-button {
  position: relative;
  background: #303134;
  border: 1px solid #5f6368;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
}

.file-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
