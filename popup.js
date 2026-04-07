const CLEANUP_STORAGE_KEY = "cleanupOnDomainExit";
const toggle = document.getElementById("cleanup-toggle");

async function initialize() {
  const stored = await chrome.storage.sync.get(CLEANUP_STORAGE_KEY);
  toggle.checked = Boolean(stored[CLEANUP_STORAGE_KEY]);
}

toggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    [CLEANUP_STORAGE_KEY]: toggle.checked
  });
});

void initialize();
