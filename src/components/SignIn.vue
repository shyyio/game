<script setup>
import {ref} from "vue";
import {ORIGIN_PATTERN, USERNAME_PATTERN, USERNAME_PATTERN_HINT} from "@/common/constants.js";
import ServerList from "@/components/ServerList.vue";

const STORAGE_USERNAME = "shys-power-up-factory.username";
const LOCAL_SERVER_URL = "ws://localhost:8080";
const AUTH_SERVER_URL = "https://spup-auth.shyy.io";

const emit = defineEmits(["start"]);

const step = ref("login");
const username = ref(localStorage.getItem(STORAGE_USERNAME) || "");
const error = ref("");
const connecting = ref(false);
const connectingOrigin = ref("");
const sessionToken = ref("");

function usernameValid() {
  return USERNAME_PATTERN.test(username.value);
}

function playLocal() {
  emit("start", {mode: "local", username: username.value, serverUrl: LOCAL_SERVER_URL});
}

/**
 * @param {string} path
 * @param {object} options
 * @returns {Promise<object>}
 */
async function authFetch(path, options) {
  const response = await fetch(`${AUTH_SERVER_URL}${path}`, options);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return response.json();
}

async function login() {
  if (!usernameValid() || connecting.value) {
    return;
  }
  error.value = "";
  connecting.value = true;
  try {
    const body = await authFetch("/login", {
      method: "POST",
      body: JSON.stringify({username: username.value}),
    });
    sessionToken.value = body.sessionToken;
    localStorage.setItem(STORAGE_USERNAME, username.value);
    step.value = "servers";
  } catch {
    error.value = "Could not reach the auth server";
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
    const {token} = await authFetch("/join", {
      method: "POST",
      headers: {authorization: `Bearer ${sessionToken.value}`},
      body: JSON.stringify({origin}),
    });
    emit("start", {mode: "remote", token, serverUrl: origin});
  } catch {
    error.value = "Could not join that server";
  } finally {
    connectingOrigin.value = "";
  }
}

function back() {
  step.value = "login";
  error.value = "";
}
</script>

<template>
  <div class="sign-in">
    <v-card v-if="step === 'login'" class="sign-in-card" elevation="8">
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
        <v-spacer/>
        <v-btn color="primary" variant="flat" :disabled="!usernameValid() || connecting" :loading="connecting" @click="login">Log in</v-btn>
      </v-card-actions>
    </v-card>
    <ServerList
        v-else
        :auth-server-url="AUTH_SERVER_URL"
        :connecting-origin="connectingOrigin"
        :error="error"
        @select="selectServer"
        @back="back"
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
