const DEFAULT_SETTINGS = {
  enabled: false,
  intervalMinutes: 5,
  lastClickAt: null,
  lastStatus: "Aguardando início",
  lastOk: null,
  clickCount: 0,
};

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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PROBE_BUTTON" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/content.js"],
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function runClickOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return setSettings({
      lastStatus: "Nenhuma aba ativa disponível.",
      lastOk: false,
    });
  }

  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return setSettings({
      lastStatus: "Abra a página do sistema (APEX) e tente novamente.",
      lastOk: false,
    });
  }

  const injected = await ensureContentScript(tab.id);
  if (!injected) {
    return setSettings({
      lastStatus: "Não foi possível injetar o script nesta página.",
      lastOk: false,
    });
  }

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: "CLICK_TRIAR" });
  } catch (err) {
    return setSettings({
      lastStatus: `Falha ao comunicar com a página: ${err.message || err}`,
      lastOk: false,
    });
  }

  const current = await getSettings();
  return setSettings({
    lastClickAt: Date.now(),
    lastStatus: result?.message || "Sem resposta do content script.",
    lastOk: Boolean(result?.ok),
    clickCount: result?.ok ? (current.clickCount || 0) + 1 : current.clickCount || 0,
  });
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
  await runClickOnActiveTab();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "GET_STATE") {
      sendResponse(await getSettings());
      return;
    }

    if (message.type === "START") {
      const intervalMinutes = Math.max(1, Number(message.intervalMinutes) || 5);
      await setSettings({
        enabled: true,
        intervalMinutes,
        lastStatus: "Automação ativa. Primeiro clique em andamento…",
      });
      await scheduleAlarm(intervalMinutes);
      const afterClick = await runClickOnActiveTab();
      await setSettings({
        ...afterClick,
        lastStatus: afterClick.lastOk
          ? `Ativo — próximo clique em ~${intervalMinutes} min`
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
      const result = await runClickOnActiveTab();
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
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ found: false, message: "Sem aba ativa." });
        return;
      }
      const ok = await ensureContentScript(tab.id);
      if (!ok) {
        sendResponse({ found: false, message: "Não foi possível inspecionar a página." });
        return;
      }
      try {
        const probe = await chrome.tabs.sendMessage(tab.id, { type: "PROBE_BUTTON" });
        sendResponse(probe);
      } catch (err) {
        sendResponse({ found: false, message: err.message || String(err) });
      }
    }
  })();

  return true;
});
