const els = {
  statusDot: document.getElementById("statusDot"),
  statusLabel: document.getElementById("statusLabel"),
  statusDetail: document.getElementById("statusDetail"),
  clickCount: document.getElementById("clickCount"),
  lastClick: document.getElementById("lastClick"),
  probeBox: document.getElementById("probeBox"),
  probeResult: document.getElementById("probeResult"),
  targetSelect: document.getElementById("targetSelect"),
  intervalRange: document.getElementById("intervalRange"),
  intervalInput: document.getElementById("intervalInput"),
  toggleBtn: document.getElementById("toggleBtn"),
  clickNowBtn: document.getElementById("clickNowBtn"),
};

function formatTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function clampInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(60, Math.max(1, Math.round(n)));
}

function resolveTargetKey(value) {
  return value === "despacho" ? "despacho" : "triar";
}

function renderState(state) {
  const enabled = Boolean(state.enabled);
  els.statusDot.dataset.state =
    enabled ? (state.lastOk === false ? "error" : "on") : "idle";
  els.statusLabel.textContent = enabled ? "Em execução" : "Pausado";
  els.statusDetail.textContent = state.lastStatus || "—";
  els.clickCount.textContent = String(state.clickCount || 0);
  els.lastClick.textContent = formatTime(state.lastClickAt);

  const interval = clampInterval(state.intervalMinutes);
  els.intervalRange.value = String(interval);
  els.intervalInput.value = String(interval);
  els.targetSelect.value = resolveTargetKey(state.targetKey);

  els.toggleBtn.textContent = enabled ? "Pausar" : "Iniciar";
  els.toggleBtn.dataset.running = enabled ? "true" : "false";
}

async function send(type, payload = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw new Error("Abra pelo ícone da extensão (não como página HTML).");
  }
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function refreshProbe() {
  els.probeResult.textContent = "Verificando…";
  els.probeBox.dataset.found = "";
  const targetKey = resolveTargetKey(els.targetSelect.value);
  try {
    const probe = await send("PROBE_ACTIVE_TAB", { targetKey });
    if (probe?.found) {
      els.probeBox.dataset.found = "true";
      const label = probe.label || probe.targetName || "Alvo";
      const disabled = probe.disabled ? " (desabilitado)" : "";
      els.probeResult.textContent = `Encontrado: ${label}${disabled}`;
    } else {
      els.probeBox.dataset.found = "false";
      els.probeResult.textContent =
        probe?.message || "Não encontrado nesta aba. Abra a tela do sistema.";
    }
  } catch (err) {
    els.probeBox.dataset.found = "false";
    els.probeResult.textContent = err.message || "Erro ao inspecionar a aba.";
  }
}

async function boot() {
  try {
    const state = await send("GET_STATE");
    renderState(state || {});
    await refreshProbe();
  } catch (err) {
    els.statusDetail.textContent = err.message || "Extensão não conectada.";
    els.probeBox.dataset.found = "false";
    els.probeResult.textContent = "Carregue a extensão em chrome://extensions";
  }
}

els.toggleBtn.addEventListener("click", async () => {
  const current = await send("GET_STATE");
  const intervalMinutes = clampInterval(els.intervalInput.value);
  const targetKey = resolveTargetKey(els.targetSelect.value);
  if (current?.enabled) {
    renderState(await send("STOP"));
  } else {
    renderState(await send("START", { intervalMinutes, targetKey }));
  }
  await refreshProbe();
});

els.clickNowBtn.addEventListener("click", async () => {
  els.clickNowBtn.disabled = true;
  els.clickNowBtn.textContent = "Clicando…";
  try {
    await send("SAVE_TARGET", { targetKey: resolveTargetKey(els.targetSelect.value) });
    renderState(await send("CLICK_NOW"));
    await refreshProbe();
  } finally {
    els.clickNowBtn.disabled = false;
    els.clickNowBtn.textContent = "Clicar agora";
  }
});

els.targetSelect.addEventListener("change", async () => {
  const targetKey = resolveTargetKey(els.targetSelect.value);
  renderState(await send("SAVE_TARGET", { targetKey }));
  await refreshProbe();
});

function syncIntervalInputs(from) {
  const value = clampInterval(from === "range" ? els.intervalRange.value : els.intervalInput.value);
  els.intervalRange.value = String(value);
  els.intervalInput.value = String(value);
  return value;
}

els.intervalRange.addEventListener("input", () => {
  syncIntervalInputs("range");
});

els.intervalInput.addEventListener("change", async () => {
  const intervalMinutes = syncIntervalInputs("input");
  renderState(await send("SAVE_INTERVAL", { intervalMinutes }));
});

els.intervalRange.addEventListener("change", async () => {
  const intervalMinutes = syncIntervalInputs("range");
  renderState(await send("SAVE_INTERVAL", { intervalMinutes }));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  send("GET_STATE").then(renderState);
});

boot();
