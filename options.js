const CUSTOM_BUTTON_PATTERNS_STORAGE_KEY = "customButtonTextPatterns";
const CUSTOM_DETAILS_PATTERNS_STORAGE_KEY = "customDetailsTextPatterns";
const RISKY_DETAILS_PATTERNS = [
  "nastaveni",
  "settings",
  "zobrazit",
  "show",
  "details",
  "preferences",
  "customize",
  "customise"
];

const buttonPatternsField = document.getElementById("button-patterns");
const detailsPatternsField = document.getElementById("details-patterns");
const saveButton = document.getElementById("save-patterns");
const clearButton = document.getElementById("clear-patterns");
const statusElement = document.getElementById("status");
const detailsWarningElement = document.getElementById("details-warning");

void initialize();

saveButton.addEventListener("click", async () => {
  const buttonPatterns = parsePatterns(buttonPatternsField.value);
  const detailsPatterns = parsePatterns(detailsPatternsField.value);

  await chrome.storage.sync.set({
    [CUSTOM_BUTTON_PATTERNS_STORAGE_KEY]: buttonPatterns,
    [CUSTOM_DETAILS_PATTERNS_STORAGE_KEY]: detailsPatterns
  });

  renderWarning(detailsPatterns);
  renderStatus("Patterns saved. Reload the page to apply them.", "success");
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.sync.set({
    [CUSTOM_BUTTON_PATTERNS_STORAGE_KEY]: [],
    [CUSTOM_DETAILS_PATTERNS_STORAGE_KEY]: []
  });

  buttonPatternsField.value = "";
  detailsPatternsField.value = "";
  renderWarning([]);
  renderStatus("Custom patterns cleared.", "success");
});

detailsPatternsField.addEventListener("input", () => {
  renderWarning(parsePatterns(detailsPatternsField.value));
});

async function initialize() {
  const stored = await chrome.storage.sync.get([
    CUSTOM_BUTTON_PATTERNS_STORAGE_KEY,
    CUSTOM_DETAILS_PATTERNS_STORAGE_KEY
  ]);

  buttonPatternsField.value = (stored[CUSTOM_BUTTON_PATTERNS_STORAGE_KEY] || []).join("\n");
  detailsPatternsField.value = (stored[CUSTOM_DETAILS_PATTERNS_STORAGE_KEY] || []).join("\n");
  renderWarning(parsePatterns(detailsPatternsField.value));
}

function parsePatterns(value) {
  const uniquePatterns = new Map();

  for (const line of value.split(/\r?\n/)) {
    const normalized = normalizePattern(line);
    if (normalized.length >= 3) {
      uniquePatterns.set(normalized, normalized);
    }
  }

  return Array.from(uniquePatterns.values());
}

function normalizePattern(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function renderWarning(detailsPatterns) {
  const riskyPatterns = detailsPatterns.filter((pattern) => RISKY_DETAILS_PATTERNS.includes(pattern));
  if (riskyPatterns.length === 0) {
    detailsWarningElement.textContent = "";
    return;
  }

  detailsWarningElement.textContent = `Risky details patterns: ${riskyPatterns.join(", ")}. These can click unrelated settings UI.`;
}

function renderStatus(message, type) {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
}
