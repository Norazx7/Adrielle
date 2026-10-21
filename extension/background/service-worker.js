const TARGET_NAMES = {
  triar: "TRIAR PROCESSOS",
  despacho: "Criar Despacho",
};

const ALARM_CLICK = "triar-auto-click";
const ALARM_WATCHDOG = "triar-watchdog";

const DEFAULT_STATE = {
  intervalMinutes: 5,
  jobs: {}, // { [tabId]: Job }
  orphans: {}, // intents que sobreviveem a fechamento/troca de aba
  eventLog: [],
};

const WAIT_MS = 90000;
const FAST_WAIT_MS = 2500;
const PROBE_WAIT_MS = 8000;
const ORPHAN_TTL_MS = 1000 * 60 * 60 * 24; // 24h

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
    failStreak: 0,
    createdAt: Date.now(),
    ...partial,
  };
}

/** Fila serial — evita race que apaga enabled/jobs */
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function readState() {
  const data = await chrome.storage.local.get(DEFAULT_STATE);
  return {
    intervalMinutes: Math.max(1, Number(data.intervalMinutes) || 5),
    jobs: data.jobs && typeof data.jobs === "object" ? data.jobs : {},
    orphans: data.orphans && typeof data.orphans === "object" ? data.orphans : {},
    eventLog: Array.isArray(data.eventLog) ? data.eventLog : [],
  };
}

async function writeState(next) {
  const payload = {
    intervalMinutes: Math.max(1, Number(next.intervalMinutes) || 5),
    jobs: next.jobs || {},
    orphans: next.orphans || {},
    eventLog: (next.eventLog || []).slice(-40),
  };
  await chrome.storage.local.set(payload);
  return payload;
}

async function mutateState(mutator) {
  return locked(async () => {
    const current = await readState();
    const draft = {
      intervalMinutes: current.intervalMinutes,
      jobs: { ...current.jobs },
      orphans: { ...current.orphans },
      eventLog: [...current.eventLog],
    };
    const result = (await mutator(draft)) ?? draft;
    await writeState(result);
    return result;
  });
}

function pushLog(state, message, extra = {}) {
  state.eventLog.push({
    at: Date.now(),
    message,
    ...extra,
  });
  if (state.eventLog.length > 40) {
    state.eventLog = state.eventLog.slice(-40);
  }
}

function enabledJobs(state) {
  return Object.values(state.jobs || {}).filter((j) => j && j.enabled);
}

function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return String(url).split("#")[0].split("?")[0];
  }
}

function urlsLooselyMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  if (na === nb) return true;
  // mesmo host + path base (APEX muda f?p=...)
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.origin !== ub.origin) return false;
    // Oracle APEX: mesmo app id no f?p=
    const appA = (ua.searchParams.get("p") || ua.href).split(":")[0];
    const appB = (ub.searchParams.get("p") || ub.href).split(":")[0];
    if (ua.pathname === ub.pathname && appA && appA === appB) return true;
    return ua.pathname === ub.pathname;
  } catch {
    return na.includes(nb) || nb.includes(na);
  }
}

async function ensureClickAlarm(intervalMinutes) {
  const minutes = Math.max(1, Number(intervalMinutes) || 5);
  const existing = await chrome.alarms.get(ALARM_CLICK);
  if (
    existing &&
    existing.periodInMinutes === minutes &&
    typeof existing.scheduledTime === "number"
  ) {
    return;
  }
  await chrome.alarms.create(ALARM_CLICK, {
    delayInMinutes: minutes,
    periodInMinutes: minutes,
  });
}

async function ensureWatchdogAlarm() {
  const existing = await chrome.alarms.get(ALARM_WATCHDOG);
  if (existing) return;
  await chrome.alarms.create(ALARM_WATCHDOG, {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
}

async function syncAlarms() {
  const state = await readState();
  const active = enabledJobs(state);
  if (!active.length) {
    await chrome.alarms.clear(ALARM_CLICK);
  } else {
    await ensureClickAlarm(state.intervalMinutes);
  }
  await ensureWatchdogAlarm();
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url);
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
    if (frames?.length) {
      // top frame primeiro
      return frames
        .slice()
        .sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : a.frameId - b.frameId))
        .map((f) => f.frameId);
    }
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
    msg.includes("No frame with id") ||
    msg.includes("cannot be scripted")
  );
}

/**
 * Envia para todos os frames, mas resolve cedo no primeiro sucesso.
 * Evita travar 90s × N frames (isso matava o service worker).
 */
async function broadcastFrames(tabId, message, { isSuccess } = {}) {
  const frameIds = await listFrameIds(tabId);
  if (!frameIds.length) return [];

  const results = [];
  let settled = false;

  return new Promise((resolve) => {
    let pending = frameIds.length;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(results);
    };

    for (const frameId of frameIds) {
      chrome.tabs
        .sendMessage(tabId, message, { frameId })
        .then((result) => {
          const entry = { frameId, result };
          results.push(entry);
          if (isSuccess && result && isSuccess(result)) finish();
        })
        .catch((err) => {
          results.push({ frameId, error: String(err?.message || err) });
        })
        .finally(() => {
          pending -= 1;
          if (pending <= 0) finish();
        });
    }

    // safety timeout
    setTimeout(finish, (Number(message.waitMs) || FAST_WAIT_MS) + 5000);
  });
}

function pickBestResult(results, { preferOk = false } = {}) {
  const usable = results.map((r) => r.result).filter((r) => r && typeof r === "object");
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

  // rápido primeiro
  let results = await broadcastFrames(
    tabId,
    { type: "PROBE_BUTTON", targetKey: key, waitMs: Math.min(waitMs, FAST_WAIT_MS) },
    { isSuccess: (r) => r.found }
  );
  let best = pickBestResult(results);
  if (best?.found) return best;

  // espera longa só se ainda não achou
  results = await broadcastFrames(
    tabId,
    { type: "PROBE_BUTTON", targetKey: key, waitMs },
    { isSuccess: (r) => r.found }
  );
  best = pickBestResult(results);
  if (best?.found) return best;

  return {
    found: false,
    targetKey: key,
    targetName: targetLabel(key),
    message: `"${targetLabel(key)}" não encontrado nesta aba.`,
    framesChecked: results.length,
  };
}

async function clickTab(tabId, targetKey, waitMs = WAIT_MS) {
  await ensureContentScript(tabId);
  const key = resolveTargetKey(targetKey);

  const runPass = async (passWait) =>
    broadcastFrames(
      tabId,
      { type: "CLICK_TARGET", targetKey: key, waitMs: passWait },
      { isSuccess: (r) => r.ok }
    );

  try {
    // 1) tentativa rápida
    let results = await runPass(FAST_WAIT_MS);
    let bestOk = pickBestResult(results, { preferOk: true });
    if (bestOk?.ok) return bestOk;

    // 2) tentativa longa
    results = await runPass(waitMs);
    bestOk = pickBestResult(results, { preferOk: true });
    if (bestOk?.ok) return bestOk;

    const navish =
      results.length > 0 && results.every((r) => r.error && isNavigationError({ message: r.error }));
    if (navish) {
      return {
        ok: true,
        found: true,
        expectsReload: true,
        targetKey: key,
        message: `Clique em "${targetLabel(key)}" enviado; página recarregou.`,
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
  } catch (err) {
    if (isNavigationError(err)) {
      return {
        ok: true,
        found: true,
        expectsReload: true,
        targetKey: key,
        message: `Clique em "${targetLabel(key)}" enviado; página navegou.`,
      };
    }
    throw err;
  }
}

async function upsertJob(tabId, partial, logMessage) {
  return mutateState((state) => {
    const key = String(tabId);
    const prev = state.jobs[key] || emptyJob(tabId);
    // enabled só muda se vier explicitamente no partial
    const nextJob = { ...prev, ...partial, tabId };
    if (!Object.prototype.hasOwnProperty.call(partial, "enabled")) {
      nextJob.enabled = prev.enabled;
    }
    state.jobs[key] = nextJob;
    if (logMessage) pushLog(state, logMessage, { tabId, enabled: nextJob.enabled, targetKey: nextJob.targetKey });
    return state;
  }).then((state) => state.jobs[String(tabId)]);
}

async function detachJob(tabId, reason) {
  await mutateState((state) => {
    const key = String(tabId);
    const job = state.jobs[key];
    if (!job) return state;

    if (job.enabled && job.url) {
      const orphanKey = `${resolveTargetKey(job.targetKey)}::${normalizeUrl(job.url)}`;
      state.orphans[orphanKey] = {
        targetKey: resolveTargetKey(job.targetKey),
        url: job.url,
        enabled: true,
        clickCount: job.clickCount || 0,
        detachedAt: Date.now(),
        reason,
      };
      pushLog(state, `Aba ${tabId} desconectada — intenção preservada`, {
        tabId,
        orphanKey,
        reason,
      });
    } else {
      pushLog(state, `Aba ${tabId} removida`, { tabId, reason });
    }

    delete state.jobs[key];
    return state;
  });
  await syncAlarms();
}

async function tryReattachOrphans(tab) {
  if (!tab?.id || isRestrictedUrl(tab.url)) return null;

  return mutateState((state) => {
    const now = Date.now();
    // limpa orphans velhos
    for (const [k, o] of Object.entries(state.orphans)) {
      if (!o || now - (o.detachedAt || 0) > ORPHAN_TTL_MS) delete state.orphans[k];
    }

    // já tem job ativo nesta aba?
    if (state.jobs[String(tab.id)]?.enabled) return state;

    let matchedKey = null;
    let matched = null;
    for (const [k, o] of Object.entries(state.orphans)) {
      if (!o?.enabled) continue;
      if (urlsLooselyMatch(o.url, tab.url)) {
        matchedKey = k;
        matched = o;
        break;
      }
    }
    if (!matched) return state;

    state.jobs[String(tab.id)] = emptyJob(tab.id, {
      enabled: true,
      targetKey: resolveTargetKey(matched.targetKey),
      url: tab.url || matched.url,
      title: tab.title || null,
      clickCount: matched.clickCount || 0,
      lastStatus: `Reconectado automaticamente → ${targetLabel(matched.targetKey)}`,
      lastOk: true,
    });
    delete state.orphans[matchedKey];
    pushLog(state, `Reconectado orphan na aba ${tab.id}`, {
      tabId: tab.id,
      targetKey: matched.targetKey,
    });
    return state;
  }).then(async (state) => {
    await syncAlarms();
    return state.jobs[String(tab.id)] || null;
  });
}

async function runJob(job, { force = false } = {}) {
  if (!job?.tabId) return null;

  // relê job fresco (enabled pode ter mudado)
  const freshState = await readState();
  const fresh = freshState.jobs[String(job.tabId)];
  if (!fresh || (!fresh.enabled && !force)) return fresh || null;

  let tab;
  try {
    tab = await chrome.tabs.get(fresh.tabId);
  } catch {
    await detachJob(fresh.tabId, "tabs.get falhou");
    return null;
  }

  if (isRestrictedUrl(tab.url)) {
    return upsertJob(fresh.tabId, {
      lastStatus: "URL inválida (abra o sistema APEX nesta aba).",
      lastOk: false,
      url: tab.url || null,
      title: tab.title || null,
      failStreak: (fresh.failStreak || 0) + 1,
    });
  }

  let result;
  try {
    result = await clickTab(fresh.tabId, fresh.targetKey, WAIT_MS);
  } catch (err) {
    return upsertJob(fresh.tabId, {
      lastStatus: `Erro: ${err.message || err}`,
      lastOk: false,
      url: tab.url || null,
      title: tab.title || null,
      failStreak: (fresh.failStreak || 0) + 1,
    });
  }

  const ok = Boolean(result?.ok);
  // NUNCA desliga enabled aqui
  return upsertJob(
    fresh.tabId,
    {
      lastClickAt: Date.now(),
      lastStatus: ok
        ? `${result?.message || "Clique OK"} · segue ativo`
        : `${result?.message || "Falha"} · continua tentando`,
      lastOk: ok,
      clickCount: ok ? (fresh.clickCount || 0) + 1 : fresh.clickCount || 0,
      failStreak: ok ? 0 : (fresh.failStreak || 0) + 1,
      url: tab.url || null,
      title: tab.title || null,
      targetKey: resolveTargetKey(fresh.targetKey),
    },
    ok ? `Clique OK aba ${fresh.tabId}` : `Clique falhou aba ${fresh.tabId}`
  );
}

async function runAllEnabledJobs() {
  const state = await readState();
  const jobs = enabledJobs(state);
  for (const job of jobs) {
    try {
      await runJob(job);
    } catch (err) {
      await mutateState((s) => {
        pushLog(s, `runJob exception: ${err.message || err}`, { tabId: job.tabId });
        return s;
      });
    }
  }
  await syncAlarms();
  return readState();
}

async function runDueJobs() {
  const state = await readState();
  const intervalMs = Math.max(1, state.intervalMinutes) * 60 * 1000;
  const now = Date.now();
  const due = enabledJobs(state).filter((j) => {
    if (!j.lastClickAt) return true;
    return now - j.lastClickAt >= intervalMs - 5000; // margem 5s
  });
  for (const job of due) {
    try {
      await runJob(job);
    } catch {
      /* logged inside */
    }
  }
}

const recoverTimers = new Map();

function scheduleRecover(tabId) {
  if (recoverTimers.has(tabId)) clearTimeout(recoverTimers.get(tabId));
  recoverTimers.set(
    tabId,
    setTimeout(() => {
      recoverTimers.delete(tabId);
      recoverAfterReload(tabId);
    }, 1200)
  );
}

async function recoverAfterReload(tabId) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  await tryReattachOrphans(tab);

  const state = await readState();
  const job = state.jobs[String(tabId)];
  if (!job?.enabled) return;

  await ensureContentScript(tabId);
  await upsertJob(tabId, {
    lastStatus: `Reload — procurando "${targetLabel(job.targetKey)}" (automação continua ativa)…`,
    url: tab.url || job.url,
    title: tab.title || job.title,
  });

  try {
    const probe = await probeTab(tabId, job.targetKey, WAIT_MS);
    if (probe?.found) {
      await upsertJob(tabId, {
        lastStatus: `"${probe.label || targetLabel(job.targetKey)}" pronto · automação ATIVA`,
        lastOk: true,
        failStreak: 0,
      });
    } else {
      await upsertJob(tabId, {
        lastStatus: `"${targetLabel(job.targetKey)}" ainda não apareceu · continua ATIVA e tentando`,
        lastOk: false,
      });
    }
  } catch (err) {
    if (!isNavigationError(err)) {
      await upsertJob(tabId, {
        lastStatus: `Após reload: ${err.message || err} · continua ATIVA`,
        lastOk: false,
      });
    }
  }

  await syncAlarms();
}

async function watchdogTick() {
  await ensureWatchdogAlarm();
  const state = await readState();
  const active = enabledJobs(state);

  if (active.length) {
    await ensureClickAlarm(state.intervalMinutes);

    // revalida abas vivas; detach só se realmente sumiu
    for (const job of active) {
      try {
        await chrome.tabs.get(job.tabId);
      } catch {
        await detachJob(job.tabId, "watchdog: aba inexistente");
      }
    }

    // se o alarme de clique foi perdido, dispara jobs vencidos
    await runDueJobs();
  } else {
    await chrome.alarms.clear(ALARM_CLICK);
  }

  await mutateState((s) => {
    pushLog(s, `Watchdog OK · ativas=${enabledJobs(s).length}`);
    return s;
  });
}

async function buildPopupView() {
  const state = await readState();
  const activeTab = await getActiveTab();
  const activeJob = activeTab?.id != null ? state.jobs[String(activeTab.id)] || null : null;
  const jobs = Object.values(state.jobs || {}).filter(Boolean);
  const enabledCount = jobs.filter((j) => j.enabled).length;

  return {
    intervalMinutes: state.intervalMinutes,
    activeTabId: activeTab?.id ?? null,
    activeTabTitle: activeTab?.title || null,
    activeTabUrl: activeTab?.url || null,
    activeJob,
    jobs,
    enabledCount,
    orphanCount: Object.keys(state.orphans || {}).length,
    eventLog: state.eventLog.slice(-12).reverse(),
    globalActive: enabledCount > 0,
  };
}

async function bootServiceWorker() {
  await ensureWatchdogAlarm();
  await syncAlarms();
  await mutateState((s) => {
    pushLog(s, "Service worker acordou / boot");
    return s;
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await bootServiceWorker();
});

chrome.runtime.onStartup.addListener(async () => {
  await bootServiceWorker();
});

// Garante watchdog sempre que o SW iniciar
bootServiceWorker();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === ALARM_WATCHDOG) {
      await watchdogTick();
      return;
    }
    if (alarm.name === ALARM_CLICK) {
      await runAllEnabledJobs();
    }
  } catch (err) {
    await mutateState((s) => {
      pushLog(s, `Erro no alarm ${alarm.name}: ${err.message || err}`);
      return s;
    });
    await syncAlarms();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    scheduleRecover(tabId);
  }
  if (changeInfo.url || changeInfo.title) {
    readState().then((state) => {
      if (!state.jobs[String(tabId)]) {
        if (changeInfo.status === "complete" || changeInfo.url) {
          tryReattachOrphans(tab);
        }
        return;
      }
      // Nunca mexe em enabled
      upsertJob(tabId, {
        url: tab.url || null,
        title: tab.title || null,
      });
    });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await readState();
  if (state.jobs[String(tabId)]) {
    // Não "pausa": preserva intenção em orphan para reattach
    await detachJob(tabId, "aba fechada");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

      await mutateState((state) => {
        state.intervalMinutes = intervalMinutes;
        state.jobs[String(tab.id)] = {
          ...(state.jobs[String(tab.id)] || emptyJob(tab.id)),
          tabId: tab.id,
          enabled: true,
          targetKey,
          url: tab.url || null,
          title: tab.title || null,
          failStreak: 0,
          lastStatus: `ATIVA nesta aba: ${targetLabel(targetKey)}`,
          lastOk: true,
        };
        // limpa orphan equivalente
        const orphanKey = `${targetKey}::${normalizeUrl(tab.url)}`;
        delete state.orphans[orphanKey];
        pushLog(state, `START aba ${tab.id} → ${targetLabel(targetKey)}`, {
          tabId: tab.id,
          targetKey,
        });
        return state;
      });

      await syncAlarms();
      const job = (await readState()).jobs[String(tab.id)];
      const after = await runJob(job, { force: true });
      if (after) {
        await upsertJob(tab.id, {
          enabled: true,
          lastStatus: after.lastOk
            ? `ATIVA (${targetLabel(targetKey)}) — próximo em ~${intervalMinutes} min`
            : `${after.lastStatus} · permanece ATIVA`,
        });
      }
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "STOP") {
      const tab = await getActiveTab();
      if (tab?.id) {
        await mutateState((state) => {
          const job = state.jobs[String(tab.id)];
          if (job) {
            job.enabled = false;
            job.lastStatus = "Pausado manualmente nesta aba.";
            pushLog(state, `STOP manual aba ${tab.id}`, { tabId: tab.id });
          }
          // também remove orphan dessa url/target
          for (const [k, o] of Object.entries(state.orphans)) {
            if (o && urlsLooselyMatch(o.url, tab.url)) delete state.orphans[k];
          }
          return state;
        });
      }
      await syncAlarms();
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "STOP_ALL") {
      await mutateState((state) => {
        for (const key of Object.keys(state.jobs)) {
          state.jobs[key] = {
            ...state.jobs[key],
            enabled: false,
            lastStatus: "Pausado manualmente.",
          };
        }
        state.orphans = {};
        pushLog(state, "STOP_ALL manual");
        return state;
      });
      await syncAlarms();
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
      const prev = (await readState()).jobs[String(tab.id)];
      await upsertJob(tab.id, {
        targetKey,
        url: tab.url || null,
        title: tab.title || null,
        // preserva enabled; se não existia, fica false até START
        enabled: prev ? prev.enabled : false,
      });
      await runJob((await readState()).jobs[String(tab.id)], { force: true });
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "SAVE_INTERVAL") {
      const intervalMinutes = Math.max(1, Number(message.intervalMinutes) || 5);
      await mutateState((state) => {
        state.intervalMinutes = intervalMinutes;
        pushLog(state, `Intervalo → ${intervalMinutes} min`);
        return state;
      });
      await syncAlarms();
      sendResponse(await buildPopupView());
      return;
    }

    if (message.type === "SAVE_TARGET") {
      const tab = await getActiveTab();
      const targetKey = resolveTargetKey(message.targetKey);
      if (tab?.id) {
        const prev = (await readState()).jobs[String(tab.id)];
        await upsertJob(tab.id, {
          targetKey,
          enabled: prev ? prev.enabled : false,
        });
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
  })().catch(async (err) => {
    try {
      await mutateState((s) => {
        pushLog(s, `Erro handler: ${err.message || err}`);
        return s;
      });
    } catch {
      /* ignore */
    }
    sendResponse({ error: String(err?.message || err) });
  });

  return true;
});
