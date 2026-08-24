// Settings page. Stored via chrome.storage.sync so preferences follow the
// user across Chrome profiles on the same account.

const DEFAULTS = {
  aiPrompt: ACU_AUDIT_DEFAULT_PROMPT,
  showSystemFields: false,
  coalesceSeconds: 10,
};

const presetEl = document.getElementById('preset');
const promptEl = document.getElementById('prompt');
const coalesceEl = document.getElementById('coalesce');
const showSystemEl = document.getElementById('showSystem');
const statusEl = document.getElementById('status');

function buildPresets() {
  for (const preset of ACU_AUDIT_PROMPT_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    presetEl.appendChild(option);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom';
  presetEl.appendChild(custom);
}

function syncPresetToPrompt() {
  const match = ACU_AUDIT_PROMPT_PRESETS.find(p => p.text === promptEl.value);
  presetEl.value = match ? match.id : 'custom';
}

function flash(message) {
  statusEl.textContent = message;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { statusEl.textContent = ''; }, 2200);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, data => {
    const settings = Object.assign({}, DEFAULTS, data || {});
    promptEl.value = settings.aiPrompt;
    coalesceEl.value = settings.coalesceSeconds;
    showSystemEl.checked = !!settings.showSystemFields;
    syncPresetToPrompt();
  });
}

presetEl.addEventListener('change', () => {
  const preset = ACU_AUDIT_PROMPT_PRESETS.find(p => p.id === presetEl.value);
  if (preset) promptEl.value = preset.text;
});

promptEl.addEventListener('input', syncPresetToPrompt);

document.getElementById('save').addEventListener('click', () => {
  const seconds = parseInt(coalesceEl.value, 10);
  chrome.storage.sync.set({
    aiPrompt: promptEl.value.trim() || DEFAULTS.aiPrompt,
    coalesceSeconds: isNaN(seconds) ? DEFAULTS.coalesceSeconds : Math.max(0, Math.min(300, seconds)),
    showSystemFields: showSystemEl.checked,
  }, () => flash('Saved.'));
});

document.getElementById('reset').addEventListener('click', () => {
  chrome.storage.sync.set(DEFAULTS, () => {
    load();
    flash('Defaults restored.');
  });
});

buildPresets();
load();
