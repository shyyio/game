<script setup>
import {onMounted, ref, watch} from "vue";
import {Application, Graphics, Container, FillGradient, isMobile} from "pixi.js";
import {ClientViewport} from "@/client/ClientViewport.js";
import Keyboard from "@/client/Keyboard.js";
import Mouse from "@/client/Mouse.js";
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
import {ClaimResult, ClaimResultEvent} from "@/common/ClaimEvents.js";
import {SETTING_ON, SETTING_OFF} from "@/common/constants.js";
import {CURSOR_SETTING_SHARE, CURSOR_SETTING_SHOW} from "@/mods/CursorSync/common/constants.js";
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

// Cursor-sharing toggles, mirrored to the player settings.
const shareCursor = ref(true);
const showCursors = ref(true);

// Rejection notices per ClaimResult; OK stays silent (the border appearing is the feedback).
const CLAIM_RESULT_NOTICES = {
  [ClaimResult.CLAIM_RESULT_OWNED]: "That chunk is already claimed",
  [ClaimResult.CLAIM_RESULT_LIMIT]: "Chunk limit reached",
  [ClaimResult.CLAIM_RESULT_NOT_ADJACENT]: "New chunks must touch your territory",
  [ClaimResult.CLAIM_RESULT_NOT_OWNER]: "Not your chunk",
  [ClaimResult.CLAIM_RESULT_WOULD_SPLIT]: "Unclaiming this would split your territory",
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
const TOOL_SELECT_ZOOM_MS = 650;

const gameWidth = () => window.innerWidth;
const gameHeight = () => window.innerHeight + 64;

function createShadowOverlay(width, height) {
  const container = new Container();

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

  viewport
      .drag()
      .wheel()
      .clampZoom({
        maxScale: 2,
        minScale: MIN_VIEWPORT_SCALE
      });

  if (isMobile.any) {
    viewport.pinch();
  }

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
  // One entries source: client.miniMenuEntries switches to the chunk claim menu in map mode.
  const openMenu = (tileX, tileY, screenX, screenY, onClose) => {
    const entries = client.miniMenuEntries(tileX, tileY);
    client.miniMenuLayer.open(entries, screenX, screenY, onClose);
  };
  inputHandler.onMiniMenuEntryClick(openMenu);
  inputHandler.onMapMenuEntryClick(openMenu);
  client.onEvent((event) => {
    if (!(event instanceof ClaimResultEvent)) {
      return;
    }
    const notice = CLAIM_RESULT_NOTICES[event.result];
    if (notice !== undefined) {
      notify(notice);
    }
  });
  inputHandler.onInspect((tileX, tileY) => {
    client.handleInspect(tileX, tileY);
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
      client.setCenterLock(tool != null && tool.usesCenterLock);
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
    const options = {
      scale: target,
      time: TOOL_SELECT_ZOOM_MS,
      ease: "easeOutCubic",
      removeOnInterrupt: true
    };
    if (!mobile && Mouse.currentX != null) {
      const ratio = viewport.scale.x / target;
      options.position = {
        x: Mouse.currentX - (Mouse.currentX - viewport.center.x) * ratio,
        y: Mouse.currentY - (Mouse.currentY - viewport.center.y) * ratio,
      };
    }
    viewport.animate(options);
  });

  const refreshTools = () => {
    toolbar.setTools(client.coreTools(), client.modTools());
  };
  client.cache.subscribe("playerSettings.values", refreshTools);
  refreshTools();

  const bindCursorSetting = (toggle, key) => {
    watch(toggle, on => {
      client.updatePlayerSetting(key, on ? SETTING_ON : SETTING_OFF);
    });
  };
  bindCursorSetting(shareCursor, CURSOR_SETTING_SHARE);
  bindCursorSetting(showCursors, CURSOR_SETTING_SHOW);
  client.cache.subscribe("playerSettings.values", (key, value) => {
    if (key === CURSOR_SETTING_SHARE) {
      shareCursor.value = value !== SETTING_OFF;
    }
    if (key === CURSOR_SETTING_SHOW) {
      showCursors.value = value !== SETTING_OFF;
    }
  });

  client.onViewModeChange((mode) => {
    const zoomedOut = mode !== ViewMode.WORLD;
    inputHandler.setMapMode(zoomedOut);
    mapMode = zoomedOut;
    applyEffectiveTool();
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
  <v-menu :close-on-content-click="false" location="bottom end">
    <template #activator="{ props: menuProps }">
      <v-btn v-bind="menuProps" class="settings-button" size="small" variant="elevated">Settings</v-btn>
    </template>
    <v-card min-width="260">
      <v-card-text>
        <v-switch v-model="shareCursor" label="Share my cursor" density="compact" hide-details />
        <v-switch v-model="showCursors" label="Show player cursors" density="compact" hide-details />
      </v-card-text>
    </v-card>
  </v-menu>
  <v-snackbar v-model="noticeOpen" timeout="3000">{{ noticeText }}</v-snackbar>
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}

.settings-button {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 10;
}
</style>
