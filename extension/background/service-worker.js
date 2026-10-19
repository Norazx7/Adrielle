const TARGET_NAMES = {
  triar: "TRIAR PROCESSOS",
  despacho: "Criação de Despacho",
};

const DEFAULT_SETTINGS = {
  enabled: false,
  intervalMinutes: 5,
  targetKey: "triar",
  lastClickAt: null,
  lastStatus: "Aguardando início",
  lastOk: null,
  clickCount: 0,
  trackedTabId: null,
  trackedTabUrl: null,
};

function resolveTargetKey(value) {
  return value === "despacho" ? "despacho" : "triar";
}

function targetLabel(key) {
  return TARGET_NAMES[resolveTargetKey(key)] || TARGET_NAMES.triar;
}

const WAIT_AFTER_RELOAD_MS = 60000;

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}

async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set(next);
  return next;
}

async function clearAlarm() {
  await chrome.alarms.clear("triar-auto-click");
}

async function scheduleAlarm(intervalMinutes) {
  await clearAlarm();
  const minutes = Math.max(1, Number(intervalMinutes) || 5);
  await chrome.alarms.create("triar-auto-click", {
    delayInMinutes: minutes,
    periodInMinutes: minutes,
  });
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  );
}

async function getTargetTab() {
  const settings = await getSettings();
  if (settings.trackedTabId != null) {
    try {
      const tab = await chrome.tabs.get(settings.trackedTabId);
      if (tab) return tab;
    } catch {
      /* tab closed */
    }
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function rememberTab(tab) {
  if (!tab?.id) return;
  await setSettings({
    trackedTabId: tab.id,
    trackedTabUrl: tab.url || null,
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
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
}

function isNavigationError(err) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("message port closed") ||
    msg.includes("Receiving end does not exist") ||
    msg.includes("The tab was closed") ||
    msg.includes("Frame with ID")
  );
}

async function sendClick(tabId, targetKey) {
  const key = resolveTargetKey(targetKey);
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "CLICK_TARGET",
      targetKey: key,
      waitMs: WAIT_AFTER_RELOAD_MS,
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
}

async function runClickOnTargetTab() {
  const tab = await getTargetTab();
  if (!tab?.id) {
    return setSettings({
      lastStatus: "Nenhuma aba disponível. Abra o sistema e clique em Iniciar de novo.",
      lastOk: false,
    });
  }

  if (isRestrictedUrl(tab.url)) {
    return setSettings({
      lastStatus: "Abra a página do sistema (APEX) e tente novamente.",
      lastOk: false,
    });
  }

  await rememberTab(tab);

  const injected = await ensureContentScript(tab.id);
  if (!injected) {
    return setSettings({
      lastStatus: "Não foi possível injetar o script nesta página.",
      lastOk: false,
    });
  }

  const current = await getSettings();
  const targetKey = resolveTargetKey(current.targetKey);

  let result;
  try {
    result = await sendClick(tab.id, targetKey);
  } catch (err) {
    return setSettings({
      lastStatus: `Falha ao comunicar com a página: ${err.message || err}`,
      lastOk: false,
    });
  }

  const ok = Boolean(result?.ok);
  return setSettings({
    lastClickAt: Date.now(),
    lastStatus: result?.message || "Sem resposta do content script.",
    lastOk: ok,
    clickCount: ok ? (current.clickCount || 0) + 1 : current.clickCount || 0,
  });
}

async function recoverAfterReload(tabId) {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (settings.trackedTabId != null && tabId !== settings.trackedTabId) return;

  const injected = await ensureContentScript(tabId);
  if (!injected) {
    await setSettings({
      lastStatus: "Página recarregou, mas o script não reinjetou ainda.",
      lastOk: false,
    });
    return;
  }

  const targetKey = resolveTargetKey(settings.targetKey);
  await setSettings({
    lastStatus: `Página recarregou — aguardando "${targetLabel(targetKey)}"…`,
  });

  try {
    const probe = await chrome.tabs.sendMessage(tabId, {
      type: "PROBE_BUTTON",
      targetKey,
      waitMs: WAIT_AFTER_RELOAD_MS,
    });

    if (probe?.found) {
      await setSettings({
        lastStatus: settings.enabled
          ? `"${targetLabel(targetKey)}" encontrado após reload. Próximo clique em ~${settings.intervalMinutes} min.`
          : `"${targetLabel(targetKey)}" encontrado após reload.`,
        lastOk: true,
      });
    } else {
      await setSettings({
        lastStatus: `Reload ok, mas "${targetLabel(targetKey)}" ainda não apareceu. Mantém a aba aberta.`,
        lastOk: false,
      });
    }
  } catch (err) {
    if (!isNavigationError(err)) {
      await setSettings({
        lastStatus: `Após reload: ${err.message || err}`,
        lastOk: false,
      });
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (settings.enabled) {
    await scheduleAlarm(settings.intervalMinutes);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "triar-auto-click") return;
  const settings = await getSettings();
  if (!settings.enabled) return;
  await runClickOnTargetTab();
});

// Após o APEX recarregar a página, reinjeta e espera o botão voltar
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  recoverAfterReload(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const settings = await getSettings();
  if (settings.trackedTabId === tabId) {
    await setSettings({
      trackedTabId: null,
      trackedTabUrl: null,
      lastStatus: settings.enabled
        ? "Aba monitorada foi fechada. Abra o sistema e Inicie de novo."
        : settings.lastStatus,
      lastOk: settings.enabled ? false : settings.lastOk,
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "CONTENT_READY") {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        const settings = await getSettings();
        if (settings.enabled && (settings.trackedTabId == null || settings.trackedTabId === tabId)) {
          await rememberTab(sender.tab);
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_STATE") {
      sendResponse(await getSettings());
      return;
    }

    if (message.type === "START") {
      const intervalMinutes = Math.max(1, Number(message.intervalMinutes) || 5);
      const targetKey = resolveTargetKey(message.targetKey);
      const tab = await getTargetTab();
      if (tab) await rememberTab(tab);

      await setSettings({
        enabled: true,
        intervalMinutes,
        targetKey,
        lastStatus: `Automação ativa em "${targetLabel(targetKey)}"…`,
      });
      await scheduleAlarm(intervalMinutes);
      const afterClick = await runClickOnTargetTab();
      await setSettings({
        lastStatus: afterClick.lastOk
          ? `Ativo (${targetLabel(targetKey)}) — próximo clique em ~${intervalMinutes} min`
          : afterClick.lastStatus,
      });
      sendResponse(await getSettings());
      return;
    }

    if (message.type === "STOP") {
      await clearAlarm();
      sendResponse(
        await setSettings({
          enabled: false,
          lastStatus: "Automação pausada.",
        })
      );
      return;
    }

    if (message.type === "CLICK_NOW") {
      const tab = await getTargetTab();
      if (tab) await rememberTab(tab);
      const result = await runClickOnTargetTab();
      sendResponse(result);
      return;
    }

    if (message.type === "SAVE_INTERVAL") {
      const intervalMinutes = Math.max(1, Number(message.intervalMinutes) || 5);
      const settings = await setSettings({ intervalMinutes });
      if (settings.enabled) await scheduleAlarm(intervalMinutes);
      sendResponse(settings);
      return;
    }

    if (message.type === "SAVE_TARGET") {
      const targetKey = resolveTargetKey(message.targetKey);
      sendResponse(await setSettings({ targetKey }));
      return;
    }

    if (message.type === "PROBE_ACTIVE_TAB") {
      const tab = await getTargetTab();
      if (!tab?.id) {
        sendResponse({ found: false, message: "Sem aba disponível." });
        return;
      }
      const ok = await ensureContentScript(tab.id);
      if (!ok) {
        sendResponse({ found: false, message: "Não foi possível inspecionar a página." });
        return;
      }
      const settings = await getSettings();
      const targetKey = resolveTargetKey(message.targetKey || settings.targetKey);
      try {
        const probe = await chrome.tabs.sendMessage(tab.id, {
          type: "PROBE_BUTTON",
          targetKey,
          waitMs: 8000,
        });
        sendResponse(probe);
      } catch (err) {
        sendResponse({ found: false, message: err.message || String(err) });
      }
    }
  })();

  return true;
});
