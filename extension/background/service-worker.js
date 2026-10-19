const TARGET_NAMES = {
  triar: "TRIAR PROCESSOS",
  despacho: "Criar Despacho",
};

const DEFAULT_STATE = {
  intervalMinutes: 5,
  jobs: {}, // { [tabId]: Job }
};

const WAIT_MS = 90000;
const PROBE_WAIT_MS = 12000;

function resolveTargetKey(value) {
  return value === "despacho" ? "despacho" : "triar";
}

function targetLabel(key) {
  return TARGET_NAMES[resolveTargetKey(key)] || TARGET_NAMES.triar;
}

function emptyJob(tabId, partial = {}) {
  return {
    tabId,
    enabled: false,
    targetKey: "triar",
    url: null,
    title: null,
    lastClickAt: null,
    lastStatus: "Aguardando início nesta aba",
    lastOk: null,
    clickCount: 0,
    ...partial,
  };
}

async function getState() {
  const data = await chrome.storage.local.get(DEFAULT_STATE);
  return {
    intervalMinutes: Math.max(1, Number(data.intervalMinutes) || 5),
    jobs: data.jobs && typeof data.jobs === "object" ? data.jobs : {},
  };
}

async function setState(partial) {
  const current = await getState();
  const next = {
    intervalMinutes: partial.intervalMinutes ?? current.intervalMinutes,
    jobs: partial.jobs ?? current.jobs,
  };
  await chrome.storage.local.set(next);
  return next;
}

async function upsertJob(tabId, partial) {
  const state = await getState();
  const key = String(tabId);
  const prev = state.jobs[key] || emptyJob(tabId);
  const nextJob = { ...prev, ...partial, tabId };
  const jobs = { ...state.jobs, [key]: nextJob };
  await setState({ jobs });
  return nextJob;
}

async function removeJob(tabId) {
  const state = await getState();
  const jobs = { ...state.jobs };
  delete jobs[String(tabId)];
  await setState({ jobs });
}

function enabledJobs(state) {
  return Object.values(state.jobs || {}).filter((j) => j && j.enabled);
}

async function syncAlarm() {
  const state = await getState();
  const active = enabledJobs(state);
  await chrome.alarms.clear("triar-auto-click");
  if (!active.length) return;
  const minutes = Math.max(1, Number(state.intervalMinutes) || 5);
  await chrome.alarms.create("triar-auto-click", {
    delayInMinutes: minutes,
    periodInMinutes: minutes,
  });
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/content.js"],
    });
    return true;
  } catch {
    return false;
  }
}

async function listFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames?.length) return frames.map((f) => f.frameId);
  } catch {
    /* fallback */
  }
  return [0];
}

function isNavigationError(err) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("message port closed") ||
    msg.includes("Receiving end does not exist") ||
    msg.includes("The tab was closed") ||
    msg.includes("Frame with ID") ||
    msg.includes("No frame with id")
  );
}

async function sendToAllFrames(tabId, message) {
  const frameIds = await listFrameIds(tabId);
  const results = [];

  await Promise.all(
    frameIds.map(async (frameId) => {
      try {
        const result = await chrome.tabs.sendMessage(tabId, message, { frameId });
        if (result) results.push({ frameId, result });
      } catch (err) {
        results.push({ frameId, error: String(err?.message || err) });
      }
    })
  );

  return results;
}

function pickBestResult(results, { preferOk = false } = {}) {
  const usable = results
    .map((r) => r.result)
    .filter((r) => r && typeof r === "object");

  if (preferOk) {
    const ok = usable.find((r) => r.ok);
    if (ok) return ok;
  }

  const found = usable.find((r) => r.found);
  if (found) return found;

  return usable[0] || null;
}

async function probeTab(tabId, targetKey, waitMs = PROBE_WAIT_MS) {
  await ensureContentScript(tabId);
  const key = resolveTargetKey(targetKey);
  const results = await sendToAllFrames(tabId, {
    type: "PROBE_BUTTON",
    targetKey: key,
    waitMs,
  });
  const best = pickBestResult(results);
  if (best?.found) return best;
  return {
    found: false,
    targetKey: key,
    targetName: targetLabel(key),
    message: `"${targetLabel(key)}" não encontrado em nenhum frame desta aba.`,
    framesChecked: results.length,
  };
}

async function clickTab(tabId, targetKey, waitMs = WAIT_MS) {
  await ensureContentScript(tabId);
  const key = resolveTargetKey(targetKey);

  let results;
  try {
    results = await sendToAllFrames(tabId, {
      type: "CLICK_TARGET",
      targetKey: key,
      waitMs,
    });
  } catch (err) {
    if (isNavigationError(err)) {
      return {
        ok: true,
        found: true,
        expectsReload: true,
        targetKey: key,
        message: `Clique em "${targetLabel(key)}" enviado; a página navegou/recarregou.`,
      };
    }
    throw err;
  }

  const bestOk = pickBestResult(results, { preferOk: true });
  if (bestOk?.ok) return bestOk;

  // Se a página recarregou no meio, frames falham — trata como sucesso parcial
  const navish = results.every((r) => r.error && isNavigationError({ message: r.error }));
  if (navish && results.length) {
    return {
      ok: true,
      found: true,
      expectsReload: true,
      targetKey: key,
      message: `Clique provavelmente executado; a página recarregou.`,
    };
  }

  const best = pickBestResult(results);
  if (best) return best;

  return {
    ok: false,
    found: false,
    targetKey: key,
    message: `"${targetLabel(key)}" não encontrado nesta aba.`,
    framesChecked: results.length,
  };
}

async function runJob(job) {
  if (!job?.tabId) return null;

  let tab;
  try {
    tab = await chrome.tabs.get(job.tabId);
  } catch {
    await removeJob(job.tabId);
    return null;
  }

  if (isRestrictedUrl(tab.url)) {
    return upsertJob(job.tabId, {
      lastStatus: "URL inválida nesta aba (abra o sistema APEX).",
      lastOk: false,
      url: tab.url || null,
      title: tab.title || null,
    });
  }

  let result;
  try {
    result = await clickTab(job.tabId, job.targetKey, WAIT_MS);
  } catch (err) {
    return upsertJob(job.tabId, {
      lastStatus: `Erro: ${err.message || err}`,
      lastOk: false,
      url: tab.url || null,
      title: tab.title || null,
    });
  }

  const ok = Boolean(result?.ok);
  return upsertJob(job.tabId, {
    lastClickAt: Date.now(),
    lastStatus: result?.message || "Sem resposta",
    lastOk: ok,
    clickCount: ok ? (job.clickCount || 0) + 1 : job.clickCount || 0,
    url: tab.url || null,
    title: tab.title || null,
    targetKey: resolveTargetKey(job.targetKey),
  });
}

async function runAllEnabledJobs() {
  const state = await getState();
  const jobs = enabledJobs(state);
  for (const job of jobs) {
    await runJob(job);
  }
  return getState();
}

async function recoverAfterReload(tabId) {
  const state = await getState();
  const job = state.jobs[String(tabId)];
  if (!job?.enabled) return;

  await ensureContentScript(tabId);
  await upsertJob(tabId, {
    lastStatus: `Reload — procurando "${targetLabel(job.targetKey)}"…`,
  });

  try {
    const probe = await probeTab(tabId, job.targetKey, WAIT_MS);
    if (probe?.found) {
      await upsertJob(tabId, {
        lastStatus: `"${probe.label || targetLabel(job.targetKey)}" pronto. Próximo clique no intervalo.`,
        lastOk: true,
      });
    } else {
      await upsertJob(tabId, {
        lastStatus: `"${targetLabel(job.targetKey)}" ainda não apareceu após reload.`,
        lastOk: false,
      });
    }
  } catch (err) {
    if (!isNavigationError(err)) {
      await upsertJob(tabId, {
        lastStatus: `Após reload: ${err.message || err}`,
        lastOk: false,
      });
    }
  }
}

async function buildPopupView() {
  const state = await getState();
  const activeTab = await getActiveTab();
  const activeJob = activeTab?.id != null ? state.jobs[String(activeTab.id)] || null : null;
  const jobs = Object.values(state.jobs || {}).filter(Boolean);

  return {
    intervalMinutes: state.intervalMinutes,
    activeTabId: activeTab?.id ?? null,
    activeTabTitle: activeTab?.title || null,
    activeTabUrl: activeTab?.url || null,
    activeJob,
    jobs,
    enabledCount: jobs.filter((j) => j.enabled).length,
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  await syncAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "triar-auto-click") return;
  await runAllEnabledJobs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    recoverAfterReload(tabId);
  }
  if (changeInfo.url || changeInfo.title) {
    getState().then((state) => {
      if (!state.jobs[String(tabId)]) return;
      upsertJob(tabId, {
        url: tab.url || null,
        title: tab.title || null,
      });
    });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.jobs[String(tabId)]) {
    await removeJob(tabId);
    await syncAlarm();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "CONTENT_READY") {
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_STATE") {
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "START") {
      const tab = await getActiveTab();
      if (!tab?.id || isRestrictedUrl(tab.url)) {
        sendResponse({
          ...(await buildPopupView()),
          error: "Abra a aba do sistema APEX e tente de novo.",
        });
        return;
      }

      const intervalMinutes = Math.max(1, Number(message.intervalMinutes) || 5);
      const targetKey = resolveTargetKey(message.targetKey);
      await setState({ intervalMinutes });

      await upsertJob(tab.id, {
        enabled: true,
        targetKey,
        url: tab.url || null,
        title: tab.title || null,
        lastStatus: `Ativo nesta aba: ${targetLabel(targetKey)}`,
      });
      await syncAlarm();

      const job = (await getState()).jobs[String(tab.id)];
      const after = await runJob(job);
      if (after?.lastOk) {
        await upsertJob(tab.id, {
          lastStatus: `Ativo (${targetLabel(targetKey)}) — próximo em ~${intervalMinutes} min`,
        });
      }
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "STOP") {
      const tab = await getActiveTab();
      if (tab?.id && (await getState()).jobs[String(tab.id)]) {
        await upsertJob(tab.id, {
          enabled: false,
          lastStatus: "Pausado nesta aba.",
        });
      }
      await syncAlarm();
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "STOP_ALL") {
      const state = await getState();
      const jobs = { ...state.jobs };
      for (const key of Object.keys(jobs)) {
        jobs[key] = { ...jobs[key], enabled: false, lastStatus: "Pausado." };
      }
      await setState({ jobs });
      await syncAlarm();
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "CLICK_NOW") {
      const tab = await getActiveTab();
      if (!tab?.id || isRestrictedUrl(tab.url)) {
        sendResponse({
          ...(await buildPopupView()),
          error: "Abra a aba do sistema APEX.",
        });
        return;
      }
      const targetKey = resolveTargetKey(message.targetKey);
      await upsertJob(tab.id, {
        targetKey,
        url: tab.url || null,
        title: tab.title || null,
      });
      await runJob((await getState()).jobs[String(tab.id)]);
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "SAVE_INTERVAL") {
      const intervalMinutes = Math.max(1, Number(message.intervalMinutes) || 5);
      await setState({ intervalMinutes });
      await syncAlarm();
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "SAVE_TARGET") {
      const tab = await getActiveTab();
      const targetKey = resolveTargetKey(message.targetKey);
      if (tab?.id) {
        await upsertJob(tab.id, { targetKey });
      }
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "PROBE_ACTIVE_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id || isRestrictedUrl(tab.url)) {
        sendResponse({ found: false, message: "Sem aba APEX ativa." });
        return;
      }
      const targetKey = resolveTargetKey(message.targetKey);
      const probe = await probeTab(tab.id, targetKey, PROBE_WAIT_MS);
      sendResponse(probe);
      return;
    }
  })();

  return true;
});
