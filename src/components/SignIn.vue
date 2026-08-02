<script setup>
import {ref} from "vue";
import {ORIGIN_PATTERN, USERNAME_PATTERN, USERNAME_PATTERN_HINT} from "@/common/constants.js";

const STORAGE_USERNAME = "shys-power-up-factory.username";
const STORAGE_SERVER_URL = "shys-power-up-factory.serverUrl";
const DEFAULT_SERVER_URL = "ws://localhost:8080";
const AUTH_SERVER_URL = "https://spup-auth.shyy.io";

const emit = defineEmits(["start"]);

const username = ref(localStorage.getItem(STORAGE_USERNAME) || "");
const serverUrl = ref(localStorage.getItem(STORAGE_SERVER_URL) || DEFAULT_SERVER_URL);
const error = ref("");
const connecting = ref(false);

const usernameRules = [
  value => USERNAME_PATTERN.test(value) || USERNAME_PATTERN_HINT,
];

function usernameValid() {
  return USERNAME_PATTERN.test(username.value);
}

// Doubles as the origin the client dials and the aud it requests a token for.
function resolveServerUrl() {
  const withScheme = /^wss?:\/\//i.test(serverUrl.value) ? serverUrl.value : `wss://${serverUrl.value}`;
  const withPort = /:[0-9]{1,5}$/.test(withScheme) ? withScheme : `${withScheme}:443`;
  return withPort.toLowerCase();
}

function playLocal() {
  emit("start", {mode: "local", username: username.value, serverUrl: resolveServerUrl()});
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

/**
 * @param {string} origin
 * @returns {Promise<string>} a signed join token
 */
async function fetchJoinToken(origin) {
  const {sessionToken} = await authFetch("/login", {
    method: "POST",
    body: JSON.stringify({username: username.value}),
  });
  const {token} = await authFetch("/join", {
    method: "POST",
    headers: {authorization: `Bearer ${sessionToken}`},
    body: JSON.stringify({origin}),
  });
  return token;
}

async function connect() {
  if (!usernameValid() || connecting.value) {
    return;
  }
  const origin = resolveServerUrl();
  if (!ORIGIN_PATTERN.test(origin)) {
    error.value = "Server must be host:port, e.g. example.com:443";
    return;
  }
  error.value = "";
  connecting.value = true;
  try {
    const token = await fetchJoinToken(origin);
    localStorage.setItem(STORAGE_USERNAME, username.value);
    localStorage.setItem(STORAGE_SERVER_URL, serverUrl.value);
    emit("start", {mode: "remote", token, serverUrl: origin});
  } catch {
    error.value = "Could not reach the auth server";
  } finally {
    connecting.value = false;
  }
}
</script>

<template>
  <div class="sign-in">
    <v-card class="sign-in-card" elevation="8">
      <v-card-title>Shy's Power-Up Factory</v-card-title>
      <v-card-text>
        <v-text-field
            v-model="username"
            label="Name"
            :rules="usernameRules"
            autofocus
            @keyup.enter="connect"
        />
        <v-text-field
            v-model="serverUrl"
            label="Server"
        />
        <div v-if="error" class="sign-in-error">{{ error }}</div>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="playLocal">Play local</v-btn>
        <v-spacer/>
        <v-btn color="primary" variant="flat" :disabled="!usernameValid() || connecting" :loading="connecting" @click="connect">Connect</v-btn>
      </v-card-actions>
    </v-card>
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
