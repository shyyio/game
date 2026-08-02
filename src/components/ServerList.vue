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

onMounted(async () => {
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
});

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
    <v-card-title>Select a server</v-card-title>
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
              &middot; {{ statusByOrigin[origin].chunksClaimed }}/{{ statusByOrigin[origin].chunksClaimed + statusByOrigin[origin].chunksAvailable }} chunks claimed
            </template>
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

.server-list-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 8px;
}
</style>
