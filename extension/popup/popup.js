const els = {
  statusDot: document.getElementById("statusDot"),
  statusLabel: document.getElementById("statusLabel"),
  statusDetail: document.getElementById("statusDetail"),
  clickCount: document.getElementById("clickCount"),
  lastClick: document.getElementById("lastClick"),
  probeBox: document.getElementById("probeBox"),
  probeResult: document.getElementById("probeResult"),
  tabInfo: document.getElementById("tabInfo"),
  jobsResult: document.getElementById("jobsResult"),
  targetSelect: document.getElementById("targetSelect"),
  intervalRange: document.getElementById("intervalRange"),
  intervalInput: document.getElementById("intervalInput"),
  toggleBtn: document.getElementById("toggleBtn"),
  clickNowBtn: document.getElementById("clickNowBtn"),
  stopAllBtn: document.getElementById("stopAllBtn"),
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

function targetName(key) {
  return resolveTargetKey(key) === "despacho" ? "Criar Despacho" : "TRIAR PROCESSOS";
}

function shortTitle(title, url) {
  const t = (title || "").trim();
  if (t && t !== "New Tab") return t.length > 42 ? `${t.slice(0, 40)}…` : t;
  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url.slice(0, 42);
    }
  }
  return "Aba sem título";
}

function renderState(view) {
  const job = view.activeJob;
  const enabled = Boolean(job?.enabled);

  els.statusDot.dataset.state = enabled ? (job?.lastOk === false ? "error" : "on") : "idle";
  els.statusLabel.textContent = enabled ? "Ativo nesta aba" : "Pausado nesta aba";
  els.statusDetail.textContent = job?.lastStatus || view.error || "Escolha a ação e inicie nesta aba.";
  els.clickCount.textContent = String(job?.clickCount || 0);
  els.lastClick.textContent = formatTime(job?.lastClickAt);

  const interval = clampInterval(view.intervalMinutes);
  els.intervalRange.value = String(interval);
  els.intervalInput.value = String(interval);

  const targetKey = resolveTargetKey(job?.targetKey || els.targetSelect.value);
  els.targetSelect.value = targetKey;

  els.tabInfo.textContent = view.activeTabId
    ? `#${view.activeTabId} · ${shortTitle(view.activeTabTitle, view.activeTabUrl)}`
    : "Nenhuma aba ativa";

  const enabledJobs = (view.jobs || []).filter((j) => j.enabled);
  if (!enabledJobs.length) {
    els.jobsResult.textContent = "Nenhuma";
  } else {
    els.jobsResult.textContent = enabledJobs
      .map((j) => `#${j.tabId} ${targetName(j.targetKey)}`)
      .join(" · ");
  }

  els.toggleBtn.textContent = enabled ? "Pausar esta aba" : "Iniciar nesta aba";
  els.toggleBtn.dataset.running = enabled ? "true" : "false";
}

async function send(type, payload = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw new Error("Abra pelo ícone da extensão.");
  }
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function refreshProbe() {
  els.probeResult.textContent = "Verificando em todos os frames…";
  els.probeBox.dataset.found = "";
  const targetKey = resolveTargetKey(els.targetSelect.value);
  try {
    const probe = await send("PROBE_ACTIVE_TAB", { targetKey });
    if (probe?.found) {
      els.probeBox.dataset.found = "true";
      const label = probe.label || probe.targetName || targetName(targetKey);
      const disabled = probe.disabled ? " (desabilitado)" : "";
      els.probeResult.textContent = `Encontrado: ${label}${disabled}`;
    } else {
      els.probeBox.dataset.found = "false";
      els.probeResult.textContent =
        probe?.message || "Não encontrado. Confirme que o botão está visível nesta aba.";
    }
  } catch (err) {
    els.probeBox.dataset.found = "false";
    els.probeResult.textContent = err.message || "Erro ao inspecionar.";
  }
}

async function boot() {
  try {
    const view = await send("GET_STATE");
    renderState(view || {});
    await refreshProbe();
  } catch (err) {
    els.statusDetail.textContent = err.message || "Extensão não conectada.";
    els.probeBox.dataset.found = "false";
    els.probeResult.textContent = "Recarregue a extensão em chrome://extensions";
  }
}

els.toggleBtn.addEventListener("click", async () => {
  const view = await send("GET_STATE");
  const intervalMinutes = clampInterval(els.intervalInput.value);
  const targetKey = resolveTargetKey(els.targetSelect.value);
  if (view?.activeJob?.enabled) {
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
    const targetKey = resolveTargetKey(els.targetSelect.value);
    renderState(await send("CLICK_NOW", { targetKey }));
    await refreshProbe();
  } finally {
    els.clickNowBtn.disabled = false;
    els.clickNowBtn.textContent = "Clicar agora";
  }
});

els.stopAllBtn.addEventListener("click", async () => {
  renderState(await send("STOP_ALL"));
  await refreshProbe();
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

els.intervalRange.addEventListener("input", () => syncIntervalInputs("range"));

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
