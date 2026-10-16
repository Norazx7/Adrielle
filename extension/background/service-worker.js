const DEFAULT_SETTINGS = {
  enabled: false,
  intervalMinutes: 5,
  lastClickAt: null,
  lastStatus: "Aguardando início",
  lastOk: null,
  clickCount: 0,
  trackedTabId: null,
  trackedTabUrl: null,
};

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

async function sendClick(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "CLICK_TRIAR",
      waitMs: WAIT_AFTER_RELOAD_MS,
    });
  } catch (err) {
    if (isNavigationError(err)) {
      return {
        ok: true,
        found: true,
        expectsReload: true,
        message: "Clique enviado; a página recarregou (normal após triar).",
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

  let result;
  try {
    result = await sendClick(tab.id);
  } catch (err) {
    return setSettings({
      lastStatus: `Falha ao comunicar com a página: ${err.message || err}`,
      lastOk: false,
    });
  }

  const current = await getSettings();
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

  await setSettings({
    lastStatus: "Página recarregou — aguardando o botão TRIAR PROCESSOS…",
  });

  try {
    const probe = await chrome.tabs.sendMessage(tabId, {
      type: "PROBE_BUTTON",
      waitMs: WAIT_AFTER_RELOAD_MS,
    });

    if (probe?.found) {
      await setSettings({
        lastStatus: settings.enabled
          ? `Botão encontrado após reload. Próximo clique em ~${settings.intervalMinutes} min.`
          : "Botão encontrado após reload.",
        lastOk: true,
      });
    } else {
      await setSettings({
        lastStatus: "Reload ok, mas o botão ainda não apareceu. Mantém a aba aberta.",
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
      const tab = await getTargetTab();
      if (tab) await rememberTab(tab);

      await setSettings({
        enabled: true,
        intervalMinutes,
        lastStatus: "Automação ativa. Localizando botão (aguarda reload se precisar)…",
      });
      await scheduleAlarm(intervalMinutes);
      const afterClick = await runClickOnTargetTab();
      await setSettings({
        lastStatus: afterClick.lastOk
          ? `Ativo — próximo clique em ~${intervalMinutes} min (sobrevive a reload)`
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
      try {
        const probe = await chrome.tabs.sendMessage(tab.id, {
          type: "PROBE_BUTTON",
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
