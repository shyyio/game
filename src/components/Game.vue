<script setup>
import {computed, onMounted, onUnmounted, ref} from "vue";
import {useTheme} from "vuetify";
import {createPixiApp} from "@/client/PixiApp.js";
import {createClient} from "@/client/GameBootstrap.js";
import {EffectiveToolController} from "@/client/input/EffectiveToolController.js";
import {bindGameKeyboardShortcuts} from "@/client/input/GameKeyboardShortcuts.js";
import {useSettingsMenu} from "@/composables/useSettingsMenu.js";
import Mobile from "@/client/Mobile.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import DeviceSettings, {
  DEVICE_SETTING_MOBILE,
  DEVICE_SETTING_REDUCED_MOTION,
  DEVICE_SETTING_THEME,
} from "@/client/state/DeviceSettings.js";
import {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
import {DeviceSettingChoice} from "@/client/hud/DeviceSettingChoice.js";
import {applyTheme, onThemeChange, THEME_DEFAULT} from "@/client/Theme.js";
import {vuetifyThemeName} from "@/client/vuetifyTheme.js";
import {gameStart, startError} from "@/client/GameStart.js";
import {useRouter} from "vue-router";

const router = useRouter();
const settingsOpen = ref(false);

const {settingsCategories, settingValues, bindSettingsMenu} = useSettingsMenu();

Mobile.setEnabled(DeviceSettings.getBoolean(DEVICE_SETTING_MOBILE, Mobile.devicePrefers()));
// Before the dialog can open, so its first open honors the preference.
ReducedMotion.setEnabled(DeviceSettings.getBoolean(DEVICE_SETTING_REDUCED_MOTION, ReducedMotion.devicePrefers()));
const reducedMotion = ref(ReducedMotion.enabled);
const stopMotionSync = ReducedMotion.onChange(on => reducedMotion.value = on);

// A false transition drops the dialog's slide; the scrim fade goes with the root class.
const dialogTransition = computed(() => {
  if (reducedMotion.value) {
    return false;
  }
  return "dialog-bottom-transition";
});
// Before the HUD builds, so the first paint is in the chosen palette.
applyTheme(DeviceSettings.getNumber(DEVICE_SETTING_THEME, THEME_DEFAULT));

// The menus are Vuetify, not pixi: same setting, their own theme.
const vuetifyTheme = useTheme();
const stopThemeSync = onThemeChange(themeId => {
  vuetifyTheme.global.name.value = vuetifyThemeName(themeId);
});

// Set once setup finishes; onUnmounted may fire mid-setup (a fast back-navigation), so each
// await below checks `disposed` and unwinds whatever it already built instead of racing ahead.
let disposed = false;
let teardown = () => {};

onMounted(async () => {
  const pixiApp = await createPixiApp();
  if (disposed) {
    pixiApp.destroy();
    return;
  }
  const {app, viewport, syncMobileTouchInput, destroy: destroyPixiApp} = pixiApp;

  // A failed join (unreachable server, mods that will not load) goes back to the server list with
  // the reason, instead of leaving an empty canvas mounted.
  let bootstrap;
  try {
    bootstrap = await createClient(app, viewport, gameStart.value);
  } catch (error) {
    destroyPixiApp();
    startError.value = error.message;
    router.push({name: "servers"});
    return;
  }
  if (disposed) {
    bootstrap.inputHandler.destroy();
    bootstrap.destroy();
    destroyPixiApp();
    return;
  }
  const {client, game, inputHandler, destroy: destroyClient} = bootstrap;

  const toolController = new EffectiveToolController(client, viewport, client.toolbarLayer, inputHandler);
  toolController.init();

  // Installs/tears down touch input and recomputes center-lock/pan-freeze when the
  // "Touchscreen input" toggle flips mid-session.
  const unsubMobile = Mobile.onChange(() => {
    syncMobileTouchInput();
    toolController.applyEffectiveTool();
  });

  bindSettingsMenu(client);
  client.settingsButtonLayer.onPress(() => settingsOpen.value = true);

  const unbindKeyboard = bindGameKeyboardShortcuts(client, game, client.toolbarLayer);

  teardown = () => {
    unbindKeyboard();
    inputHandler.destroy();
    unsubMobile();
    destroyClient();
    destroyPixiApp();
  };
});

onUnmounted(() => {
  disposed = true;
  stopMotionSync();
  stopThemeSync();
  teardown();
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
  <v-dialog v-model="settingsOpen" max-width="480" content-class="settings-dialog" :transition="dialogTransition">
    <v-card>
      <v-toolbar title="Settings">
        <v-btn variant="text" @click="settingsOpen = false">Close</v-btn>
      </v-toolbar>
      <v-card-text>
        <div class="settings-list">
          <template v-for="category in settingsCategories" :key="category.name">
            <div class="settings-category-title">{{ category.name }}</div>
            <template v-for="control in category.controls" :key="control.key">
              <v-select
                  v-if="control instanceof PlayerSettingChoice || control instanceof DeviceSettingChoice"
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
          </template>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
#game {
  position: absolute;
  overflow: hidden;
}
</style>

<!-- Unscoped: the dialog content is teleported outside this component. -->
<style>
/* The scrim fade is Vuetify's own, not the `transition` prop's; its duration is !important. */
.reduced-motion .v-overlay__scrim {
  transition-duration: 0s !important;
}

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

.settings-dialog .settings-category-title {
  font-size: 0.875rem;
  font-weight: 500;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-dialog .settings-category-title:not(:first-child) {
  margin-top: 8px;
}
</style>
