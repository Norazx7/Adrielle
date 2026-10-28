const runBtn = document.getElementById("runBtn");
const status = document.getElementById("status");
const autoSubmit = document.getElementById("autoSubmit");

async function boot() {
  const data = await chrome.storage.local.get({ autoSubmit: true });
  autoSubmit.checked = data.autoSubmit !== false;
}

autoSubmit.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoSubmit: autoSubmit.checked });
});

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  status.textContent = "Preenchendo…";
  try {
    await chrome.storage.local.set({ autoSubmit: autoSubmit.checked });
    const result = await chrome.runtime.sendMessage({
      type: "RUN_ON_ACTIVE_TAB",
      config: { autoSubmit: autoSubmit.checked },
    });
    status.textContent = result?.message || (result?.ok ? "OK" : "Falhou");
  } catch (err) {
    status.textContent = err.message || String(err);
  } finally {
    runBtn.disabled = false;
  }
});

boot();
