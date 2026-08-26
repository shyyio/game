<script setup>
import {computed, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {ORIGIN_PATTERN, USERNAME_PATTERN, USERNAME_PATTERN_HINT} from "@/common/constants.js";
import ServerList from "@/components/ServerList.vue";
import {hasSessionToken, login as authClientLogin, mintJoinToken} from "@/client/AuthClient.js";
import {GAME_MODE_LOCAL, GAME_MODE_REMOTE, startGame, startError} from "@/client/GameStart.js";
import {readLocalLoadout} from "@/client/LocalLoadout.js";

const STORAGE_USERNAME = "spup.username";
const LOCAL_SERVER_URL = "ws://localhost:27500";

const route = useRoute();
const router = useRouter();

const username = ref(localStorage.getItem(STORAGE_USERNAME) || "");
const error = ref(startError.value);
startError.value = "";
const connecting = ref(false);
const connectingOrigin = ref("");
// A stored list that no longer parses is the mods screen's problem to report, not a reason the
// login screen cannot render.
const localModCount = ref(countLocalMods());

watch(() => route.name, () => {
  error.value = "";
  localModCount.value = countLocalMods();
});

function usernameValid() {
  return USERNAME_PATTERN.test(username.value);
}

/**
 * @returns {number}
 */
function countLocalMods() {
  try {
    return readLocalLoadout().mods.length;
  } catch {
    return 0;
  }
}

const localModsLabel = computed(() => {
  if (localModCount.value === 0) {
    return "Mods";
  }
  return `Mods (${localModCount.value})`;
});

function browseMods() {
  router.push({name: "mods"});
}

function playLocal() {
  startGame({mode: GAME_MODE_LOCAL, username: username.value, serverUrl: LOCAL_SERVER_URL});
  // A full page load, not a route change: mod packages register into module-level state that is
  // assigned once and cannot be rebuilt, so a second start in the same document runs against
  // whatever the first one left behind. startGame() kept the params across the reload.
  window.location.assign(router.resolve({name: "play"}).href);
}

async function login() {
  if (!usernameValid() || connecting.value) {
    return;
  }
  error.value = "";
  connecting.value = true;
  try {
    await authClientLogin(username.value);
    localStorage.setItem(STORAGE_USERNAME, username.value);
    router.push({name: "servers"});
  } catch {
    error.value = "Login failed, please try again in a few minutes";
  } finally {
    connecting.value = false;
  }
}

/**
 * @param {string} origin
 * @returns {Promise<void>}
 */
async function selectServer(origin) {
  if (!ORIGIN_PATTERN.test(origin) || connectingOrigin.value) {
    return;
  }
  error.value = "";
  connectingOrigin.value = origin;
  try {
    const token = await mintJoinToken(origin);
    startGame({mode: GAME_MODE_REMOTE, token, serverUrl: origin});
    router.push({name: "play"});
  } catch {
    // mintJoinToken already clears the stored token on a 401; hasSessionToken() distinguishes
    // an expired/invalid session (bounce home) from any other join failure (show inline error).
    if (!hasSessionToken()) {
      unauthorized();
    } else {
      error.value = "Could not join that server";
    }
  } finally {
    connectingOrigin.value = "";
  }
}

function unauthorized() {
  router.push({name: "login"});
}

function back() {
  router.back();
}
</script>

<template>
  <div class="sign-in">
    <v-card v-if="route.name === 'login'" class="sign-in-card" elevation="8">
      <v-card-title>Shy's Power-Up Factory</v-card-title>
      <v-card-text>
        <v-text-field
            v-model="username"
            label="Name"
            :hint="USERNAME_PATTERN_HINT"
            autofocus
            @keyup.enter="login"
        />
        <div v-if="error" class="sign-in-error">{{ error }}</div>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="playLocal">Play local</v-btn>
        <v-btn variant="text" @click="browseMods">{{ localModsLabel }}</v-btn>
        <v-spacer/>
        <v-btn color="primary" variant="flat" :disabled="!usernameValid() || connecting" :loading="connecting" @click="login">Log in</v-btn>
      </v-card-actions>
    </v-card>
    <ServerList
        v-else
        :connecting-origin="connectingOrigin"
        :error="error"
        @select="selectServer"
        @back="back"
        @mods="browseMods"
        @unauthorized="unauthorized"
    />
  </div>
</template>

<style scoped>
.sign-in {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  /* top-third keeps card above mobile keyboard */
  padding-top: 12vh;
  background: #f5f0e6;
}

.sign-in-card {
  width: min(90vw, 360px);
}

.sign-in-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 8px;
}
</style>
