<script setup>
import {onMounted, reactive, ref} from "vue";
import {httpOriginFor} from "@/common/util.js";
import {hasSessionToken, listServers} from "@/client/AuthClient.js";

const props = defineProps({
  connectingOrigin: {type: String, default: ""},
  error: {type: String, default: ""},
});

const emit = defineEmits(["select", "back", "unauthorized"]);

const DEV_SERVER_ORIGIN = "ws://localhost:8080";
const DEV_SERVER_NAME = "🧪 DEV";

const REFRESH_COOLDOWN_MS = 3000;

const servers = ref([]);
// origin -> {loading, offline, name, online, chunksClaimed, chunksAvailable, pingMs}
const statusByOrigin = reactive({});
const refreshing = ref(false);
const refreshCoolingDown = ref(false);

onMounted(loadServers);

/**
 * @returns {void}
 */
function refresh() {
  if (refreshCoolingDown.value) {
    return;
  }
  refreshCoolingDown.value = true;
  setTimeout(() => {
    refreshCoolingDown.value = false;
  }, REFRESH_COOLDOWN_MS);
  loadServers();
}

/**
 * @returns {Promise<void>}
 */
async function loadServers() {
  refreshing.value = true;
  try {
    servers.value = await listServers();
  } catch {
    servers.value = [];
    if (!hasSessionToken()) {
      refreshing.value = false;
      emit("unauthorized");
      return;
    }
  }
  if (import.meta.env.DEV && !servers.value.some((server) => server.origin === DEV_SERVER_ORIGIN)) {
    servers.value = [{origin: DEV_SERVER_ORIGIN}, ...servers.value];
  }
  for (const {origin} of servers.value) {
    preconnect(origin);
  }
  for (const {origin} of servers.value) {
    statusByOrigin[origin] = {loading: true, offline: false};
    fetchStatus(origin);
  }
  refreshing.value = false;
}

const preconnectedOrigins = new Set();

/**
 * Opens the connection to a server's status endpoint ahead of fetchStatus(), so the first ping
 * after page load isn't inflated by DNS/TCP/TLS handshake time.
 * @param {string} origin
 * @returns {void}
 */
function preconnect(origin) {
  const httpOrigin = httpOriginFor(origin);
  if (preconnectedOrigins.has(httpOrigin)) {
    return;
  }
  preconnectedOrigins.add(httpOrigin);
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = httpOrigin;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

/**
 * @param {string} origin
 * @returns {Promise<void>}
 */
async function fetchStatus(origin) {
  const url = `${httpOriginFor(origin)}/status`;
  const timingPromise = observeNetworkDurationMs(url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const body = await response.json();
    statusByOrigin[origin] = {
      loading: false,
      offline: false,
      name: body.name,
      online: body.online,
      chunksClaimed: body.chunksClaimed,
      chunksAvailable: body.chunksAvailable,
      pingMs: await timingPromise,
    };
  } catch {
    statusByOrigin[origin] = {loading: false, offline: true};
  }
}

const RESOURCE_TIMING_TIMEOUT_MS = 5000;

/**
 * Resource Timing duration for the given request, matching what devtools' network panel reports.
 * Observes live via PerformanceObserver rather than reading the shared buffer, since Vite's own
 * module fetches fill that buffer's default capacity well before a status request completes.
 * @param {string} url
 * @returns {Promise<number>}
 */
function observeNetworkDurationMs(url) {
  // Browsers normalize away default ports (e.g. ":443") when recording an entry's name, so an
  // origin like "https://host:443/status" must be compared against its normalized form too.
  const normalizedUrl = new URL(url).href;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`No resource timing entry for ${url}`));
    }, RESOURCE_TIMING_TIMEOUT_MS);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === normalizedUrl) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(Math.round(entry.duration));
          return;
        }
      }
    });
    observer.observe({type: "resource"});
  });
}

const MIN_CHUNK_BAR_PERCENT = 1;

/**
 * The percentage of the region claimed, for the chunk bar's fill; clamped to a visible sliver
 * once any chunk is claimed, since a true 0.01% fill renders as nothing.
 * @param {string} origin
 * @returns {number}
 */
function chunkPercent(origin) {
  const status = statusByOrigin[origin];
  const total = status.chunksClaimed + status.chunksAvailable;
  if (total === 0 || status.chunksClaimed === 0) {
    return 0;
  }
  return Math.max(MIN_CHUNK_BAR_PERCENT, Math.round(status.chunksClaimed / total * 100));
}

/**
 * @param {string} origin
 * @returns {void}
 */
function select(origin) {
  if (props.connectingOrigin || statusByOrigin[origin]?.offline || statusByOrigin[origin]?.loading) {
    return;
  }
  emit("select", origin);
}
</script>

<template>
  <v-card class="server-list-card" elevation="8">
    <v-card-title>Server Directory</v-card-title>
    <v-card-text>
      <div v-if="servers.length === 0" class="server-list-empty">No servers configured</div>
      <div
          v-for="{origin} in servers"
          :key="origin"
          class="server-row"
          :class="{'server-row-offline': statusByOrigin[origin]?.offline}"
          @click="select(origin)"
      >
        <div class="server-row-main">
          <div class="server-row-name">{{ origin === DEV_SERVER_ORIGIN ? DEV_SERVER_NAME : (statusByOrigin[origin]?.name || origin) }}</div>
          <div class="server-row-detail">
            <template v-if="statusByOrigin[origin]?.loading">Pinging…</template>
            <template v-else-if="statusByOrigin[origin]?.offline">Offline</template>
            <template v-else>
              {{ statusByOrigin[origin].pingMs }}ms
              &middot; {{ statusByOrigin[origin].online }} online
            </template>
          </div>
          <div v-if="statusByOrigin[origin] && !statusByOrigin[origin].loading && !statusByOrigin[origin].offline" class="server-row-chunks">
            <v-progress-linear
                :model-value="chunkPercent(origin)"
                :height="10"
                color="primary"
            />
            <span class="server-row-chunks-label">{{ chunkPercent(origin) }}% full</span>
          </div>
        </div>
        <v-btn
            color="primary"
            variant="flat"
            size="small"
            :disabled="statusByOrigin[origin]?.offline || statusByOrigin[origin]?.loading || !!connectingOrigin"
            :loading="connectingOrigin === origin"
            @click.stop="select(origin)"
        >Connect</v-btn>
      </div>
      <div v-if="error" class="server-list-error">{{ error }}</div>
    </v-card-text>
    <v-card-actions>
      <v-btn variant="text" @click="emit('back')">Back</v-btn>
      <v-spacer/>
      <v-btn variant="text" :disabled="refreshCoolingDown" :loading="refreshing" @click="refresh">Refresh</v-btn>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.server-list-card {
  width: min(90vw, 480px);
}

.server-list-empty {
  opacity: 0.7;
  font-size: 0.875rem;
}

.server-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  cursor: pointer;
}

.server-row:last-child {
  border-bottom: none;
}

.server-row-offline {
  opacity: 0.5;
  cursor: default;
}

.server-row-name {
  font-weight: 500;
}

.server-row-detail {
  font-size: 0.8rem;
  opacity: 0.7;
}

.server-row-chunks {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.server-row-chunks .v-progress-linear {
  width: 120px;
  flex: 0 0 120px;
}

.server-row-chunks-label {
  font-size: 0.75rem;
  opacity: 0.6;
  white-space: nowrap;
}

.server-list-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 8px;
}
</style>
