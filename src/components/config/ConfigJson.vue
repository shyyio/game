<script setup>
import {ref, watch} from "vue";
import {mdiContentCopy, mdiCheck} from "@mdi/js";

const props = defineProps({
  // The settings as a plain object; edits here parse back into one.
  modelValue: {type: Object, required: true},
  // Throws with a reason when the pasted object is not a valid config.
  validate: {type: Function, required: true},
});
const emit = defineEmits(["update:modelValue"]);

const text = ref(format(props.modelValue));
const error = ref("");
const copied = ref(false);

watch(() => props.modelValue, value => {
  text.value = format(value);
  error.value = "";
});

/**
 * @param {object} value
 * @returns {string}
 */
function format(value) {
  return JSON.stringify(value, null, 4);
}

function apply() {
  let parsed;
  try {
    parsed = JSON.parse(text.value);
    props.validate(parsed);
  } catch (applyError) {
    error.value = applyError.message;
    return;
  }
  error.value = "";
  emit("update:modelValue", parsed);
}

async function copy() {
  await navigator.clipboard.writeText(text.value);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1500);
}
</script>

<template>
  <div class="config-json">
    <div class="config-json-note">Copy to keep these settings, or paste a copy and apply it.</div>
    <div class="config-json-block">
      <v-textarea v-model="text" auto-grow rows="6" hide-details class="config-json-text" spellcheck="false"/>
      <v-btn
          class="config-json-copy"
          :icon="copied ? mdiCheck : mdiContentCopy"
          :aria-label="copied ? 'Copied' : 'Copy'"
          :title="copied ? 'Copied' : 'Copy'"
          size="small"
          variant="text"
          @click="copy"
      />
    </div>
    <div v-if="error" class="config-json-error">{{ error }}</div>
    <div class="config-json-actions">
      <v-btn size="small" variant="flat" color="primary" @click="apply">Confirm</v-btn>
    </div>
  </div>
</template>

<style scoped>
.config-json-note {
  opacity: 0.65;
  font-size: 0.8125rem;
}

.config-json-block {
  position: relative;
  margin-top: 12px;
}

/* The sizer is auto-grow's hidden twin; it must measure in the same font or the box overshoots. */
.config-json-text :deep(textarea),
.config-json-text :deep(.v-textarea__sizer) {
  font-family: monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  /* Right padding keeps the JSON from running under the button. */
  padding-right: 60px;
}

.config-json-copy {
  position: absolute;
  top: 8px;
  right: 8px;
}

.config-json-error {
  color: #b3261e;
  font-size: 0.875rem;
  margin-top: 12px;
}

.config-json-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
