<script setup>
import {onMounted, reactive, ref, watch} from "vue";
import {Application, Graphics, Container, FillGradient, isMobile} from "pixi.js";
import {ClientViewport} from "@/client/ClientViewport.js";
import Keyboard from "@/client/Keyboard.js";
import Mouse from "@/client/Mouse.js";
import {MobileTouchInput} from "@/client/MobileTouchInput.js";
import DeviceSettings, {DEVICE_SETTING_FULLSCREEN, DEVICE_SETTING_REDUCED_MOTION} from "@/client/DeviceSettings.js";
import Fullscreen from "@/client/Fullscreen.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import WindowFocus from "@/client/WindowFocus.js";
import {InputHandler} from "@/client/InputHandler.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {clientLoadout} from "@/mods/clientLoadout.js";
import {Belts} from "@/mods/Logistics/sim/Belts.js";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ClientSaveStore} from "@/client/ClientSaveStore.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {LocalSession} from "@/sim/LocalSession.js";
import {RemoteSession} from "@/client/RemoteSession.js";
import {WireRegistry} from "@/common/wire.js";
import {Client} from "@/client/Client.js";
import {PlayerSettingChoice} from "@/client/PlayerSettingChoice.js";
import {PlayerSettingToggle} from "@/client/PlayerSettingToggle.js";
import {ClaimResult, ClaimResultEvent} from "@/common/ClaimEvents.js";
import {UnclaimChunkMessage} from "@/common/ClaimMessages.js";
import {SETTING_ON, SETTING_OFF} from "@/common/constants.js";
import {GAME_FONT, ViewMode, MIN_VIEWPORT_SCALE} from "@/client/constants.js";
import {DEV} from "@/common/env.js";

const props = defineProps({
  mode: {type: String, default: "local"},
  username: {type: String, default: ""},
  serverUrl: {type: String, default: ""},
});

// Feeds the v-snackbar (claim rejections, disconnects).
const noticeText = ref("");
const noticeOpen = ref(false);

// The chunk awaiting the destructive unclaim confirmation, or null (dialog closed).
const unclaimChunk = ref(null);
let confirmUnclaim = null;

// Mod-contributed settings-menu controls, each mirrored to its player setting by key.
const settingsOpen = ref(false);
const settingsControls = ref([]);
const settingValues = reactive({});

// Device-local fullscreen preference.
const fullscreenEnabled = ref(false);

// Device-local reduced-motion preference.
const reducedMotionEnabled = ref(false);

// Rejection notices per ClaimResult; OK stays silent (the border appearing is the feedback).
const CLAIM_RESULT_NOTICES = {
  [ClaimResult.CLAIM_RESULT_OWNED]: "That chunk is already claimed",
  [ClaimResult.CLAIM_RESULT_LIMIT]: "Chunk limit reached",
  [ClaimResult.CLAIM_RESULT_NOT_ADJACENT]: "New chunks must touch one of your claimed chunks",
  [ClaimResult.CLAIM_RESULT_NOT_OWNER]: "Not your chunk",
  [ClaimResult.CLAIM_RESULT_WOULD_SPLIT]: "Unclaiming this would split your claimed chunks",
};

function notify(text) {
  noticeText.value = text;
  noticeOpen.value = true;
}

// Mobile mode (touch device): panning stays live while a tool is active so the
// player can aim the screen-center crosshair, hover/placement lock to center, and
// the pixi rotate button replaces the "r" key.
const mobile = isMobile.any;

// Selecting a tool zooms in to at least this scale (a no-op if already past it): on
// mobile, far enough that tiles are large enough to aim the center crosshair; on desktop,
// just past the map-mode threshold (0.25) so a tool is usable without leaving map mode far.
const TOOL_SELECT_ZOOM_MOBILE = 0.7;
const TOOL_SELECT_ZOOM_DESKTOP = 0.4;

const gameWidth = () => window.innerWidth;
const gameHeight = () => window.innerHeight + 64;

function createShadowOverlay(width, height) {
  const container = new Container();
  // Decorative only; an "auto" full-screen overlay would swallow viewport hits.
  container.eventMode = "none";

  const leftGradient = new FillGradient({
    type: "linear",
    start: {x: 0, y: 0},
    end: {x: 1, y: 0},
    colorStops: [
      {offset: 0, color: "0x00000011"},
      {offset: 0.9, color: "0x00000000"},
    ],
  });

  const rightGradient = new FillGradient({
    type: "linear",
    start: {x: 0, y: 0},
    end: {x: 1, y: 0},
    colorStops: [
      {offset: 0.9, color: "0x00000000"},
      {offset: 1, color: "0x00000011"},
    ],
  });

  container.addChild(
      new Graphics()
          .rect(0, 0, width, height)
          .fill(leftGradient)
  );

  container.addChild(
      new Graphics()
          .rect(0, 0, width, height)
          .fill(rightGradient)
  );

  return container;
}

onMounted(async () => {

  const app = new Application();

  await app.init({
    background: "#f5f0e6",
    resolution: window.devicePixelRatio,
    resizeTo: window,
    autoDensity: true,
    roundPixels: true
  });

  // The whole game runs at a fixed 24fps, so one ticker tick is exactly one
  // animation frame (see animation.js).
  app.ticker.maxFPS = 24;

  // Load the game font before pixi rasterizes any text; a Text drawn before the face
  // is ready caches at the fallback and never re-rasterizes on its own.
  await document.fonts.load(`1em ${GAME_FONT}`);

  const viewport = new ClientViewport({
    screenWidth: gameWidth(),
    screenHeight: gameHeight(),
    worldWidth: gameWidth(),
    worldHeight: gameHeight(),
    events: app.renderer.events,
    threshold: 20,
    // Drags ride globalpointermove: crossing the HUD or leaving the canvas keeps the pan alive.
    allowPreserveDragOutside: true,
  });

  // The world's transform is the one thing that changes every pan and zoom frame. As a render
  // group the viewport carries it as a group matrix applied on the GPU, instead of pixi walking
  // every layer and sprite under it to re-derive world transforms.
  viewport.enableRenderGroup();

  app.stage.addChild(viewport);

  let overlay = createShadowOverlay(gameWidth(), gameHeight());
  app.stage.addChild(overlay);

  function handleResize() {
    viewport.resize(gameWidth(), gameHeight(), gameWidth(), gameHeight());

    app.stage.removeChild(overlay);
    overlay.destroy();
    overlay = createShadowOverlay(gameWidth(), gameHeight());
    app.stage.addChild(overlay);
  }

  window.addEventListener("resize", () => {
    handleResize();
  });
  // Window resize fires before fullscreen dimensions are real; the visual-viewport resize
  // re-runs the sizing afterward.
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      app.resize();
      handleResize();
    });
  }

  viewport
      .drag()
      .wheel()
      .clampZoom({
        maxScale: 2,
        minScale: MIN_VIEWPORT_SCALE
      });

  if (isMobile.any) {
    viewport.pinch();
    new MobileTouchInput(app, viewport).install();
  }

  Fullscreen.install();
  fullscreenEnabled.value = DeviceSettings.getBoolean(DEVICE_SETTING_FULLSCREEN, false);
  Fullscreen.setEnabled(fullscreenEnabled.value);
  watch(fullscreenEnabled, on => {
    DeviceSettings.setBoolean(DEVICE_SETTING_FULLSCREEN, on);
    // The switch tap is the user gesture the fullscreen request needs.
    Fullscreen.setEnabled(on);
  });

  reducedMotionEnabled.value = DeviceSettings.getBoolean(DEVICE_SETTING_REDUCED_MOTION, ReducedMotion.devicePrefers());
  ReducedMotion.setEnabled(reducedMotionEnabled.value);
  watch(reducedMotionEnabled, on => {
    DeviceSettings.setBoolean(DEVICE_SETTING_REDUCED_MOTION, on);
    ReducedMotion.setEnabled(on);
  });

  Mouse.init(app, viewport);
  WindowFocus.init();

  document.getElementById("game").appendChild(app.canvas);

  const modRegistry = new ModRegistry();
  for (const pkg of clientLoadout()) {
    modRegistry.register(pkg);
  }
  modRegistry.freeze();

  // Local mode hosts the sim in-process; remote mode has no Game at all — the server owns it.
  let game = null;
  let session;
  if (props.mode === "remote") {
    session = new RemoteSession(new WireRegistry(modRegistry), props.serverUrl, props.username);
    session.onClose(code => {
      notify(`Disconnected from server (${code})`);
    });
  } else {
    game = new Game(modRegistry, new GameEngine(modRegistry), new ClientSaveStore());
    await game.init();

    // Dev scenarios populate the world before any session connects, so the objects reach the
    // client through the normal chunk sync. DEV is a build-time literal, so the whole scenario
    // tree drops out of production bundles.
    if (DEV) {
      const {applyScenarioFromLocation} = await import("@/test/scenarios/index.js");
      await applyScenarioFromLocation(game);
    }

    session = new LocalSession(new GameAPI(game));
  }

  const client = new Client(app, viewport, session, modRegistry);
  session.client = client;
  if (game === null) {
    session.connect();
  } else {
    game.connect(session);
  }
  await client.init();

  const toolbar = client.toolbarLayer;

  const inputHandler = new InputHandler(toolbar);
  inputHandler.onMiniMenuEntryClick((tileX, tileY, screenX, screenY, onClose) => {
    const entries = client.miniMenuEntries(tileX, tileY);
    client.miniMenuLayer.open(entries, screenX, screenY, onClose);
  });
  client.onEvent((event) => {
    if (!(event instanceof ClaimResultEvent)) {
      return;
    }
    // A non-empty unclaim asks for the destructive confirmation instead of a notice.
    if (event.result === ClaimResult.CLAIM_RESULT_NOT_EMPTY) {
      unclaimChunk.value = event.chunk;
      return;
    }
    const notice = CLAIM_RESULT_NOTICES[event.result];
    if (notice !== undefined) {
      notify(notice);
    }
  });
  confirmUnclaim = () => {
    client.sendMessage(new UnclaimChunkMessage(unclaimChunk.value, true));
    unclaimChunk.value = null;
  };
  inputHandler.onInspect((tileX, tileY) => {
    client.handleInspect(tileX, tileY);
  });
  inputHandler.onMapHover((tileX, tileY) => {
    client.claimSelection.handleHover(tileX, tileY);
  });
  inputHandler.onMapTap((tileX, tileY) => {
    client.claimSelection.handleSelect(tileX, tileY);
  });
  inputHandler.init();

  client.rotateButtonsLayer.onRotate(() => inputHandler.rotateRight());

  // Map and overworld mode (zoomed far out) deactivate the active tool without clearing the
  // toolbar selection, so the cursor acts as if nothing were selected and the tool resumes on
  // zoom-in. The effective tool (null when zoomed out) drives the side effects below.
  let mapMode = false;

  // Applies the effective-tool side effects on both tool changes and map-mode toggles:
  // drop the current ghost/hover, toggle the rotate button, and freeze pan (desktop) or
  // enable center-lock (mobile) while a tool is active.
  const applyEffectiveTool = () => {
    const tool = mapMode ? null : toolbar.activeTool;
    inputHandler.clearToolPreview();
    inputHandler.clearInspect();
    inputHandler.refreshHover();
    client.rotateButtonsLayer.setVisible(tool != null && tool.orientable);
    if (mobile) {
      // Map mode locks the "cursor" to the screen center too.
      client.setCenterLock(mapMode || (tool != null && tool.usesCenterLock));
      return;
    }
    if (tool != null) {
      viewport.freezePan();
    } else {
      viewport.unfreezePan();
    }
  };

  // Selecting a toolbar tool zooms in. On desktop the zoom homes on the mouse cursor
  toolbar.onChange(() => {
    applyEffectiveTool();
    const target = mobile ? TOOL_SELECT_ZOOM_MOBILE : TOOL_SELECT_ZOOM_DESKTOP;
    if (toolbar.activeTool == null || viewport.scale.x >= target) {
      return;
    }
    if (!mobile && Mouse.currentX != null) {
      const ratio = viewport.scale.x / target;
      viewport.glideTo({
        x: Mouse.currentX - (Mouse.currentX - viewport.center.x) * ratio,
        y: Mouse.currentY - (Mouse.currentY - viewport.center.y) * ratio,
        scale: target,
      });
      return;
    }
    viewport.glideTo({scale: target});
  });

  const refreshTools = () => {
    toolbar.setTools(client.coreTools(), client.modTools());
  };
  client.cache.subscribe("playerSettings.values", refreshTools);
  refreshTools();

  const controls = client.settingsControls();
  // Per-type value mirroring: a toggle models a boolean, a choice models the option index.
  const controlModel = (control, value) => {
    if (control instanceof PlayerSettingChoice) {
      return value === undefined ? control.defaultIndex : value;
    }
    if (control instanceof PlayerSettingToggle) {
      return value !== SETTING_OFF;
    }
    throw new Error(`Settings control "${control.label}" has an unknown control type`);
  };
  const controlByKey = new Map(controls.map(control => [control.key, control]));
  client.cache.subscribe("playerSettings.values", (key, value) => {
    const control = controlByKey.get(key);
    if (control !== undefined) {
      settingValues[key] = controlModel(control, value);
    }
  });
  const playerSettings = client.cache.view("playerSettings");
  for (const control of controls) {
    // Seed from the cache: the settings sync may have landed during client init.
    settingValues[control.key] = controlModel(control, playerSettings.get(control.key));
    watch(() => settingValues[control.key], modelValue => {
      if (control instanceof PlayerSettingChoice) {
        client.updatePlayerSetting(control.key, modelValue);
        return;
      }
      client.updatePlayerSetting(control.key, modelValue ? SETTING_ON : SETTING_OFF);
    });
  }
  settingsControls.value = controls;

  client.onViewModeChange((mode) => {
    const zoomedOut = mode !== ViewMode.WORLD;
    inputHandler.setMapMode(zoomedOut);
    mapMode = zoomedOut;
    applyEffectiveTool();
  });

  // "c" toggles claim selection; "q" exits any input mode; "h" glides home.
  Keyboard.on("c", () => {
    client.claimSelection.toggle();
  });
  Keyboard.on("q", () => {
    toolbar.setActiveTool(null);
    client.claimSelection.set(false);
  });
  Keyboard.on("h", () => {
    client.glideHome();
  });

  // The local sim ticks by key; the server drives its own tick loop in remote mode.
  if (game !== null) {
    // Debug keybindings (moved off the number keys, which now select tools).
    // Insert an item of value 1 onto the lowest-id belt path via its in-port.
    Keyboard.on("b", () => {
      game.simEngine.resolve(Belts).debugInsertItem();
    });

    Keyboard.on("t", () => {
      game.runTick();
    });

    window.setInterval(() => {
      // game.runTick()
    }, 600);
  }

  // Toggle debug mode
  Keyboard.on("d", () => {
    client.toggleDebugMode();
  });
});

</script>

<script>
import {defineComponent} from "vue";

export default defineComponent({
  name: "Game",
})

</script>

<template>
  <div id="game">
  </div>
  <v-dialog v-model="settingsOpen" max-width="480" content-class="settings-dialog" transition="dialog-bottom-transition">
    <template #activator="{ props: dialogProps }">
      <v-btn v-bind="dialogProps" class="settings-button" size="small" variant="elevated">Settings</v-btn>
    </template>
    <v-card>
      <v-toolbar title="Settings">
        <v-btn variant="text" @click="settingsOpen = false">Close</v-btn>
      </v-toolbar>
      <v-card-text>
        <div class="settings-list">
          <v-switch
              v-model="fullscreenEnabled"
              label="Fullscreen"
              color="primary"
              density="compact"
              hide-details
          />
          <v-switch
              v-model="reducedMotionEnabled"
              label="Reduced motion"
              color="primary"
              density="compact"
              hide-details
          />
          <template v-for="control in settingsControls" :key="control.key">
            <v-select
                v-if="control instanceof PlayerSettingChoice"
                v-model="settingValues[control.key]"
                :label="control.label"
                :items="control.items"
                variant="solo"
                density="compact"
                hide-details
            />
            <v-switch
                v-else
                v-model="settingValues[control.key]"
                :label="control.label"
                color="primary"
                density="compact"
                hide-details
            />
          </template>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
  <v-snackbar v-model="noticeOpen" timeout="3000">{{ noticeText }}</v-snackbar>
  <v-dialog :model-value="unclaimChunk !== null" max-width="420" @update:model-value="unclaimChunk = null">
    <v-card title="Unclaim chunk?">
      <v-card-text>
        This chunk still contains buildings. Unclaiming will permanently delete everything in it.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="unclaimChunk = null">Cancel</v-btn>
        <v-btn color="error" @click="confirmUnclaim()">Delete and unclaim</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}

.settings-button {
  position: fixed;
  top: max(env(safe-area-inset-top, 0px), 12px);
  right: max(env(safe-area-inset-right, 0px), 12px);
  z-index: 10;
}
</style>

<!-- Unscoped: the dialog content is teleported outside this component. -->
<style>
.v-dialog > .settings-dialog {
  margin: max(env(safe-area-inset-top, 0px), 24px)
          max(env(safe-area-inset-right, 0px), 24px)
          max(env(safe-area-inset-bottom, 0px), 24px)
          max(env(safe-area-inset-left, 0px), 24px);
}

.settings-dialog .settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
