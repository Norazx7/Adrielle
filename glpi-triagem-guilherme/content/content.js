(() => {
  if (window.__glpiTriagemBridge?.booted) return;
  window.__glpiTriagemBridge = { booted: true, version: "1.2.0" };

  function injectMainWorld() {
    // Injeta page-fill.js no contexto da página (acessa jQuery/Select2/TinyMCE reais)
    const url = chrome.runtime.getURL("content/page-fill.js");
    const existing = document.querySelector(`script[data-glpi-triagem="1"]`);
    if (existing) existing.remove();

    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = false;
      s.dataset.glpiTriagem = "1";
      s.onload = () => {
        s.remove();
        resolve({ ok: true, via: "script-src" });
      };
      s.onerror = () => resolve({ ok: false, via: "script-src", error: "falha ao carregar page-fill.js" });
      (document.documentElement || document.head).appendChild(s);
    });
  }

  async function runFill(config = {}) {
    // Preferir executeScript MAIN via background; fallback script tag
    try {
      const result = await chrome.runtime.sendMessage({
        type: "INJECT_MAIN_FILL",
        config,
      });
      if (result) return result;
    } catch {
      /* popup/background pode injetar */
    }
    return injectMainWorld();
  }

  function ensureFab() {
    if (!/ticket\.form\.php/i.test(location.href) && !document.querySelector(".action-task")) return;
    if (document.getElementById("glpi-triagem-fab")) return;

    const fab = document.createElement("button");
    fab.id = "glpi-triagem-fab";
    fab.type = "button";
    fab.textContent = "TRIAGEM";
    fab.title = "Preencher tarefa (main world)";
    fab.addEventListener("click", async () => {
      fab.disabled = true;
      fab.textContent = "...";
      const stored = await chrome.storage.local.get({ autoSubmit: true });
      const result = await runFill({ autoSubmit: stored.autoSubmit !== false });
      fab.textContent = result?.ok === false ? "ERRO" : "OK";
      setTimeout(() => {
        fab.disabled = false;
        fab.textContent = "TRIAGEM";
      }, 2000);
    });
    document.documentElement.appendChild(fab);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ ok: true, href: location.href });
      return;
    }
    if (message?.type === "FILL_TRIAGEM") {
      runFill(message.config || {}).then(sendResponse);
      return true;
    }
  });

  ensureFab();
  new MutationObserver(() => ensureFab()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
