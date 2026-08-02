<script setup>
import {onMounted, reactive, ref} from "vue";
import {httpOriginFor} from "@/common/util.js";

const props = defineProps({
  authServerUrl: {type: String, required: true},
  connectingOrigin: {type: String, default: ""},
  error: {type: String, default: ""},
});

const emit = defineEmits(["select", "back"]);

const servers = ref([]);
// origin -> {loading, offline, name, online, chunksClaimed, chunksAvailable, pingMs}
const statusByOrigin = reactive({});
const refreshing = ref(false);

onMounted(refresh);

/**
 * @returns {Promise<void>}
 */
async function refresh() {
  refreshing.value = true;
  try {
    const response = await fetch(`${props.authServerUrl}/servers`);
    const body = await response.json();
    servers.value = body.servers;
  } catch {
    servers.value = [];
  }
  for (const {origin} of servers.value) {
    statusByOrigin[origin] = {loading: true, offline: false};
    fetchStatus(origin);
  }
  refreshing.value = false;
}

/**
 * @param {string} origin
 * @returns {Promise<void>}
 */
async function fetchStatus(origin) {
  const startedAtMs = performance.now();
  try {
    const response = await fetch(`${httpOriginFor(origin)}/status`);
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
      pingMs: Math.round(performance.now() - startedAtMs),
    };
  } catch {
    statusByOrigin[origin] = {loading: false, offline: true};
  }
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
  if (props.connectingOrigin) {
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
          <div class="server-row-name">{{ statusByOrigin[origin]?.name || origin }}</div>
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
      <v-btn variant="text" :loading="refreshing" @click="refresh">Refresh</v-btn>
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
