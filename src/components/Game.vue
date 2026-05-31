<script setup>
import {defineComponent, onMounted} from "vue";
import {Application, Assets, Graphics, Container, FillGradient, Text, isMobile, Texture, Sprite} from "pixi.js";
import {Viewport} from "pixi-viewport";
import Keyboard from "@/keyboard.js";
import Mouse from "@/mouse.js";
import {BrowserGameBackend} from "@/backend/BrowserGameBackend.js";
import ClientState from "@/client/ClientState.js";
import ClientRenderer from "@/client/ClientRenderer.js";
import clientState from "@/client/ClientState.js";
import "@/components/Game.vue";
import BuildSystem from "@/client/buildSystem.js";
import {TickPhase} from "@/backend/core.js";

const gameWidth = () => window.innerWidth - Number(document.getElementById("game").style.left.replace("px", ""));
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

function createDebugInfo() {

  const text = new Text({
    text: "Loading...",
    style: {
      fontFamily: "monospace",
      fontSize: 18,
      fill: '#FF00FF',
    }
  });

  text.x = 20;
  text.y = 10;

  return text;
}

/**
 * @type {Viewport}
 */
let VIEWPORT = null;

/**
 * @type {Container}
 */
let GRID_CONTAINER = null;

/**
 * @param text {Text}
 */
function updateDebugText(text) {

  let beltInfo = "";
  const belt = clientState.getBelt(Mouse.tileX, Mouse.tileY);
  if (belt) {
    beltInfo = `id=${belt.id}, direction=${belt.direction}, bend=${belt.bend}`;
  } else {
    beltInfo = `${Mouse.tileX}, ${Mouse.tileY}`;
  }

  text.text =`${beltInfo}`;

}

onMounted(async () => {

  const app = new Application();

  // Intialize the application.
  await app.init({
    background: "white",
    resolution: window.devicePixelRatio,
    resizeTo: window,
    autoDensity: true,
    roundPixels: true
  });

  const viewport = new Viewport({
    screenWidth: gameWidth(),
    screenHeight: gameHeight(),
    worldWidth: gameWidth(),
    worldHeight: gameHeight(),
    events: app.renderer.events,
    threshold: 20,
  });

  // add the viewport to the stage
  app.stage.addChild(viewport);

  let overlay = createShadowOverlay(gameWidth(), gameHeight())
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

  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutationRecord) {
      handleResize();
    });
  });

  observer.observe(document.getElementById("game"), {attributes: true, attributeFilter: ['style']});

  viewport
      .drag()
      .wheel()
      .clampZoom({
        maxScale: 2,
        minScale: 0.05
        // TODO: when zooming out too much, switch to a simplified grid view (?)
      });

  if (isMobile.any) {
    viewport.pinch().decelerate();
  }

  const container = new Container();
  viewport.addChild(container);
  VIEWPORT = viewport;

  GRID_CONTAINER = new Container();
  container.addChild(GRID_CONTAINER);

  const debugText = createDebugInfo();
  app.stage.addChild(debugText);

  app.ticker.add(() => {
    updateDebugText(debugText);
  });


  Mouse.init(app, viewport);

  document.getElementById("game").appendChild(app.canvas);

  const backend = new BrowserGameBackend();
  await backend.init();

  window.DB = sql => {
    return backend.execPretty(sql);
  }

  ClientState.renderer = new ClientRenderer(app, viewport);
  await ClientState.renderer.loadTextures();
  ClientState.registerEventListeners(app, backend, viewport);

  BuildSystem.init(app, viewport, backend);

  let counter = 0;

  function tick() {
    backend.tick(TickPhase.SUBMIT_INTENTS);
    backend.tick(TickPhase.RESOLVE_TRANSFERS);
    backend.tick(TickPhase.POST_RESOLVE);
    backend.tick(TickPhase.COMMIT_TRANSFERS);
  }

  Keyboard.on("i", () => {
    backend.debugAddItem();
    tick();
    counter += 1;
  });
  Keyboard.on("t", () => {
    tick();
    counter += 1;
  });

  Keyboard.on("e", () => {
    backend.debugPrintDbSize();
  });

  Keyboard.on("m", () => {
    backend.exportDb();
  });

  Keyboard.on("p", () => {
    backend.printProfilingData();
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
  <div id="game" :style="{left: $store.state.canvasLeft + 'px'}">
  </div>
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}
</style>