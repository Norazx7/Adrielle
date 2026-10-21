const els = {
  statusDot: document.getElementById("statusDot"),
  statusLabel: document.getElementById("statusLabel"),
  statusDetail: document.getElementById("statusDetail"),
  clickCount: document.getElementById("clickCount"),
  lastClick: document.getElementById("lastClick"),
  probeBox: document.getElementById("probeBox"),
  probeResult: document.getElementById("probeResult"),
  globalInfo: document.getElementById("globalInfo"),
  tabInfo: document.getElementById("tabInfo"),
  jobsResult: document.getElementById("jobsResult"),
  eventLog: document.getElementById("eventLog"),
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
  const enabledHere = Boolean(job?.enabled);
  const globalActive = Boolean(view.globalActive || view.enabledCount > 0);

  if (enabledHere) {
    els.statusDot.dataset.state = job?.lastOk === false ? "error" : "on";
    els.statusLabel.textContent = "ATIVA nesta aba";
  } else if (globalActive) {
    els.statusDot.dataset.state = "on";
    els.statusLabel.textContent = "Outras abas ativas";
  } else {
    els.statusDot.dataset.state = "idle";
    els.statusLabel.textContent = "Parada nesta aba";
  }

  els.statusDetail.textContent =
    job?.lastStatus ||
    view.error ||
    (globalActive
      ? "Esta aba não tem automação; outras seguem rodando."
      : "Escolha a ação e inicie nesta aba.");

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

  const enabledCount = view.enabledCount || 0;
  const orphanCount = view.orphanCount || 0;
  if (enabledCount > 0) {
    els.globalInfo.textContent = `${enabledCount} aba(s) rodando · watchdog ativo`;
    els.globalBox?.setAttribute("data-found", "true");
  } else if (orphanCount > 0) {
    els.globalInfo.textContent = `0 ativas · ${orphanCount} intenção(ões) aguardando reconectar`;
    els.globalBox?.setAttribute("data-found", "false");
  } else {
    els.globalInfo.textContent = "Nenhuma automação ativa";
    els.globalBox?.setAttribute("data-found", "false");
  }

  const enabledJobs = (view.jobs || []).filter((j) => j.enabled);
  if (!enabledJobs.length) {
    els.jobsResult.textContent = orphanCount
      ? `Nenhuma aberta · ${orphanCount} para reconectar`
      : "Nenhuma";
  } else {
    els.jobsResult.textContent = enabledJobs
      .map((j) => `#${j.tabId} ${targetName(j.targetKey)}`)
      .join(" · ");
  }

  if (Array.isArray(view.eventLog) && view.eventLog.length) {
    els.eventLog.textContent = view.eventLog
      .slice(0, 8)
      .map((e) => `${formatTime(e.at)} · ${e.message}`)
      .join("\n");
  } else {
    els.eventLog.textContent = "Sem eventos ainda";
  }

  els.toggleBtn.textContent = enabledHere ? "Pausar esta aba" : "Iniciar nesta aba";
  els.toggleBtn.dataset.running = enabledHere ? "true" : "false";
}

// globalBox may be used before optional chaining assign - get element
const globalBox = document.getElementById("globalBox");
els.globalBox = globalBox;

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
        probe?.message || "Não encontrado. Confirme que o botão está nesta aba.";
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
