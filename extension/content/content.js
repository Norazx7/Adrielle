(() => {
  const BUTTON_SELECTORS = [
    '[data-otel-label="TRIAR_NIVEL_12"]',
    '#B68314861501381838',
    'button.t-Button--hot',
  ];

  const LABEL_TEXT = "TRIAR PROCESSOS";

  function findTriarButton() {
    for (const selector of BUTTON_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) return el;
    }

    const buttons = document.querySelectorAll("button.t-Button, button");
    for (const btn of buttons) {
      const label = btn.querySelector(".t-Button-label");
      const text = (label?.textContent || btn.textContent || "").trim().toUpperCase();
      if (text.includes(LABEL_TEXT) && isVisible(btn)) return btn;
    }

    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickButton(btn) {
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    btn.focus({ preventScroll: true });

    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of events) {
      btn.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          buttons: 1,
        })
      );
    }

    if (typeof btn.click === "function") btn.click();
  }

  function flashFeedback(btn) {
    const prev = btn.style.outline;
    btn.style.outline = "3px solid #2db49e";
    btn.style.outlineOffset = "3px";
    setTimeout(() => {
      btn.style.outline = prev;
      btn.style.outlineOffset = "";
    }, 900);
  }

  async function attemptClick() {
    const btn = findTriarButton();
    if (!btn) {
      return {
        ok: false,
        message: "Botão TRIAR PROCESSOS não encontrado nesta página.",
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
      message: "Clique em TRIAR PROCESSOS executado.",
      found: true,
      buttonId: btn.id || null,
      label: (btn.querySelector(".t-Button-label")?.textContent || btn.textContent || "").trim(),
    };
  }

  function probe() {
    const btn = findTriarButton();
    return {
      found: Boolean(btn),
      buttonId: btn?.id || null,
      label: btn
        ? (btn.querySelector(".t-Button-label")?.textContent || btn.textContent || "").trim()
        : null,
      disabled: btn ? Boolean(btn.disabled || btn.getAttribute("aria-disabled") === "true") : null,
      url: location.href,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === "PROBE_BUTTON") {
      sendResponse(probe());
      return;
    }

    if (message.type === "CLICK_TRIAR") {
      attemptClick().then(sendResponse);
      return true;
    }
  });

  // Expõe estado leve na página para o popup detectar presença
  window.__triarAutoExtension = { version: "1.0.0", probe };
})();
