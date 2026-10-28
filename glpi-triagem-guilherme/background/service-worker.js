async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "INJECT_MAIN_FILL" || message.type === "RUN_ON_ACTIVE_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, message: "Nenhuma aba ativa." });
        return;
      }

      try {
        // Isolado: bridge + CSS
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/content.js"],
        });

        // MAIN world: jQuery/Select2/TinyMCE da página
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/page-fill.js"],
          world: "MAIN",
        });

        // Lê resultado se a página expôs
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => window.__glpiTriagemLastResult || { ok: true, message: "Script MAIN injetado." },
        });

        sendResponse(result || { ok: true, message: "Injetado no MAIN world." });
      } catch (err) {
        sendResponse({ ok: false, message: String(err?.message || err) });
      }
    }
  })();
  return true;
});
