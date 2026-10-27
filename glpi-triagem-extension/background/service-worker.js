async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureScript(tabId) {
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "RUN_ON_ACTIVE_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, message: "Nenhuma aba ativa." });
        return;
      }
      await ensureScript(tab.id);
      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: "FILL_TRIAGEM",
          config: message.config || {},
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({
          ok: false,
          message: `Abra um chamado do GLPI nesta aba. (${err.message || err})`,
        });
      }
      return;
    }
  })();
  return true;
});
