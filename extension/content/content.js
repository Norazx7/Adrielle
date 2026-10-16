(() => {
  if (window.__triarAutoExtension?.booted) return;

  const BUTTON_SELECTORS = [
    '[data-otel-label="TRIAR_NIVEL_12"]',
    '#B68314861501381838',
    'button.t-Button--hot',
  ];

  const LABEL_TEXT = "TRIAR PROCESSOS";
  const DEFAULT_WAIT_MS = 60000;

  function isVisible(el) {
    if (!el) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function matchesLabel(btn) {
    const label = btn.querySelector?.(".t-Button-label");
    const text = (label?.textContent || btn.textContent || "").trim().toUpperCase();
    return text.includes(LABEL_TEXT);
  }

  function findInDocument(doc) {
    if (!doc) return null;

    for (const selector of BUTTON_SELECTORS) {
      try {
        const nodes = doc.querySelectorAll(selector);
        for (const el of nodes) {
          if (isVisible(el) && (selector.includes("TRIAR") || matchesLabel(el) || el.getAttribute("data-otel-label") === "TRIAR_NIVEL_12")) {
            return el;
          }
          // hot button without label match: still accept if otel/id selectors hit
          if (isVisible(el) && (selector.startsWith("[") || selector.startsWith("#"))) {
            return el;
          }
        }
      } catch {
        /* ignore bad selectors in odd docs */
      }
    }

    try {
      const buttons = doc.querySelectorAll("button.t-Button, button, a.t-Button");
      for (const btn of buttons) {
        if (matchesLabel(btn) && isVisible(btn)) return btn;
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  function findTriarButton(rootDoc = document, depth = 0) {
    if (depth > 8) return null;

    const direct = findInDocument(rootDoc);
    if (direct) return direct;

    let iframes = [];
    try {
      iframes = Array.from(rootDoc.querySelectorAll("iframe, frame"));
    } catch {
      return null;
    }

    for (const frame of iframes) {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) continue;
        const found = findTriarButton(doc, depth + 1);
        if (found) return found;
      } catch {
        // cross-origin iframe — ignore
      }
    }

    return null;
  }

  function waitForButton(timeoutMs = DEFAULT_WAIT_MS) {
    return new Promise((resolve) => {
      const existing = findTriarButton();
      if (existing) {
        resolve(existing);
        return;
      }

      const started = Date.now();
      let done = false;

      const finish = (btn) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(poll);
        resolve(btn);
      };

      const check = () => {
        const btn = findTriarButton();
        if (btn) {
          finish(btn);
          return;
        }
        if (Date.now() - started >= timeoutMs) finish(null);
      };

      const observer = new MutationObserver(check);
      try {
        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      } catch {
        /* observe may fail on odd documents */
      }

      const poll = setInterval(check, 400);
      check();
    });
  }

  function clickButton(btn) {
    try {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      /* ignore */
    }

    try {
      btn.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }

    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of events) {
      try {
        btn.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: btn.ownerDocument?.defaultView || window,
            buttons: 1,
          })
        );
      } catch {
        /* ignore */
      }
    }

    if (typeof btn.click === "function") btn.click();
  }

  function flashFeedback(btn) {
    try {
      const prev = btn.style.outline;
      btn.style.outline = "3px solid #e10600";
      btn.style.outlineOffset = "3px";
      setTimeout(() => {
        btn.style.outline = prev;
        btn.style.outlineOffset = "";
      }, 900);
    } catch {
      /* ignore */
    }
  }

  async function attemptClick(waitMs = DEFAULT_WAIT_MS) {
    const btn = await waitForButton(waitMs);
    if (!btn) {
      return {
        ok: false,
        message: "Botão TRIAR PROCESSOS não encontrado (mesmo após aguardar o reload).",
        found: false,
      };
    }

    if (btn.disabled || btn.getAttribute("aria-disabled") === "true") {
      return {
        ok: false,
        message: "Botão encontrado, mas está desabilitado.",
        found: true,
      };
    }

    clickButton(btn);
    flashFeedback(btn);

    return {
      ok: true,
      message: "Clique em TRIAR PROCESSOS executado. Aguardando possível reload…",
      found: true,
      buttonId: btn.id || null,
      label: (btn.querySelector?.(".t-Button-label")?.textContent || btn.textContent || "").trim(),
      expectsReload: true,
    };
  }

  async function probe(waitMs = 0) {
    const btn = waitMs > 0 ? await waitForButton(waitMs) : findTriarButton();
    return {
      found: Boolean(btn),
      buttonId: btn?.id || null,
      label: btn
        ? (btn.querySelector?.(".t-Button-label")?.textContent || btn.textContent || "").trim()
        : null,
      disabled: btn ? Boolean(btn.disabled || btn.getAttribute("aria-disabled") === "true") : null,
      url: location.href,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === "PROBE_BUTTON") {
      const waitMs = Number(message.waitMs) || 0;
      if (waitMs > 0) {
        probe(waitMs).then(sendResponse);
        return true;
      }
      sendResponse(probe(0));
      return;
    }

    if (message.type === "CLICK_TRIAR") {
      const waitMs = Number(message.waitMs) || DEFAULT_WAIT_MS;
      attemptClick(waitMs).then(sendResponse);
      return true;
    }

    if (message.type === "PING") {
      sendResponse({ ok: true, href: location.href });
      return;
    }
  });

  // Reanexa watcher quando o DOM APEX recria a região após partial refresh
  const bootObserver = new MutationObserver(() => {
    // keep alive — findTriarButton already polls on demand
  });
  try {
    if (document.documentElement) {
      bootObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch {
    /* ignore */
  }

  // Avisa o background que esta aba/frame está pronta (útil após reload)
  try {
    chrome.runtime.sendMessage({ type: "CONTENT_READY", href: location.href });
  } catch {
    /* ignore */
  }

  window.__triarAutoExtension = {
    version: "1.1.0",
    booted: true,
    probe: () => probe(0),
    findTriarButton,
  };
})();
