(() => {
  if (window.__triarAutoExtension?.booted) return;

  const DEFAULT_WAIT_MS = 60000;

  const TARGETS = {
    triar: {
      key: "triar",
      name: "TRIAR PROCESSOS",
      selectors: [
        '[data-otel-label="TRIAR_NIVEL_12"]',
        '#B68314861501381838',
      ],
      texts: ["TRIAR PROCESSOS"],
      preferButtons: true,
    },
    despacho: {
      key: "despacho",
      name: "Criação de Despacho",
      selectors: [
        '[data-otel-label*="DESPACHO" i]',
        'a[title*="Criação de Despacho" i]',
        'a[aria-label*="Criação de Despacho" i]',
      ],
      texts: ["CRIAÇÃO DE DESPACHO", "CRIACAO DE DESPACHO"],
      preferButtons: false,
    },
  };

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function getTarget(targetKey) {
    return TARGETS[targetKey] || TARGETS.triar;
  }

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

  function elementText(el) {
    if (!el) return "";
    const label = el.querySelector?.(".t-Button-label, .a-TreeView-label, .t-Header-navLinkLabel, span");
    return (label?.textContent || el.getAttribute?.("title") || el.getAttribute?.("aria-label") || el.textContent || "").trim();
  }

  function matchesTargetText(el, target) {
    const text = normalizeText(elementText(el));
    return target.texts.some((t) => text.includes(normalizeText(t)));
  }

  function findClickableAncestor(el) {
    let node = el;
    for (let i = 0; i < 6 && node; i += 1) {
      if (node.matches?.("a, button, [role='button'], [onclick], .t-Button, .t-Header-navLink")) {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function findInDocument(doc, target) {
    if (!doc) return null;

    for (const selector of target.selectors) {
      try {
        const nodes = doc.querySelectorAll(selector);
        for (const el of nodes) {
          if (!isVisible(el)) continue;
          if (matchesTargetText(el, target) || selector.includes("TRIAR_NIVEL_12") || selector.startsWith("#")) {
            return findClickableAncestor(el);
          }
        }
      } catch {
        /* ignore invalid selectors */
      }
    }

    const query = target.preferButtons
      ? "button.t-Button, button, a.t-Button, a"
      : "a, button, [role='button'], .t-Header-navLink, .a-TreeView-label, li, span";

    try {
      const nodes = doc.querySelectorAll(query);
      for (const el of nodes) {
        if (!matchesTargetText(el, target)) continue;
        const clickable = findClickableAncestor(el);
        if (isVisible(clickable) || isVisible(el)) return isVisible(clickable) ? clickable : el;
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  function findTargetElement(targetKey, rootDoc = document, depth = 0) {
    if (depth > 8) return null;
    const target = getTarget(targetKey);
    const direct = findInDocument(rootDoc, target);
    if (direct) return direct;

    let frames = [];
    try {
      frames = Array.from(rootDoc.querySelectorAll("iframe, frame"));
    } catch {
      return null;
    }

    for (const frame of frames) {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) continue;
        const found = findTargetElement(targetKey, doc, depth + 1);
        if (found) return found;
      } catch {
        /* cross-origin */
      }
    }

    return null;
  }

  function waitForTarget(targetKey, timeoutMs = DEFAULT_WAIT_MS) {
    return new Promise((resolve) => {
      const existing = findTargetElement(targetKey);
      if (existing) {
        resolve(existing);
        return;
      }

      const started = Date.now();
      let done = false;

      const finish = (el) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(poll);
        resolve(el);
      };

      const check = () => {
        const el = findTargetElement(targetKey);
        if (el) {
          finish(el);
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
        /* ignore */
      }

      const poll = setInterval(check, 400);
      check();
    });
  }

  function clickElement(el) {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      /* ignore */
    }

    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }

    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of events) {
      try {
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: el.ownerDocument?.defaultView || window,
            buttons: 1,
          })
        );
      } catch {
        /* ignore */
      }
    }

    if (typeof el.click === "function") el.click();
  }

  function flashFeedback(el) {
    try {
      const prev = el.style.outline;
      el.style.outline = "3px solid #e10600";
      el.style.outlineOffset = "3px";
      setTimeout(() => {
        el.style.outline = prev;
        el.style.outlineOffset = "";
      }, 900);
    } catch {
      /* ignore */
    }
  }

  async function attemptClick(targetKey = "triar", waitMs = DEFAULT_WAIT_MS) {
    const target = getTarget(targetKey);
    const el = await waitForTarget(targetKey, waitMs);
    if (!el) {
      return {
        ok: false,
        message: `"${target.name}" não encontrado (mesmo após aguardar o reload).`,
        found: false,
        targetKey: target.key,
      };
    }

    if (el.disabled || el.getAttribute("aria-disabled") === "true") {
      return {
        ok: false,
        message: `"${target.name}" encontrado, mas está desabilitado.`,
        found: true,
        targetKey: target.key,
      };
    }

    clickElement(el);
    flashFeedback(el);

    return {
      ok: true,
      message: `Clique em "${target.name}" executado. Aguardando possível reload/navegação…`,
      found: true,
      targetKey: target.key,
      buttonId: el.id || null,
      label: elementText(el),
      expectsReload: true,
    };
  }

  async function probe(targetKey = "triar", waitMs = 0) {
    const target = getTarget(targetKey);
    const el = waitMs > 0 ? await waitForTarget(targetKey, waitMs) : findTargetElement(targetKey);
    return {
      found: Boolean(el),
      targetKey: target.key,
      targetName: target.name,
      buttonId: el?.id || null,
      label: el ? elementText(el) : null,
      disabled: el ? Boolean(el.disabled || el.getAttribute("aria-disabled") === "true") : null,
      url: location.href,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    const targetKey = message.targetKey || "triar";

    if (message.type === "PROBE_BUTTON") {
      const waitMs = Number(message.waitMs) || 0;
      if (waitMs > 0) {
        probe(targetKey, waitMs).then(sendResponse);
        return true;
      }
      sendResponse(probe(targetKey, 0));
      return;
    }

    if (message.type === "CLICK_TRIAR" || message.type === "CLICK_TARGET") {
      const waitMs = Number(message.waitMs) || DEFAULT_WAIT_MS;
      attemptClick(targetKey, waitMs).then(sendResponse);
      return true;
    }

    if (message.type === "LIST_TARGETS") {
      sendResponse(
        Object.values(TARGETS).map((t) => ({
          key: t.key,
          name: t.name,
        }))
      );
      return;
    }

    if (message.type === "PING") {
      sendResponse({ ok: true, href: location.href });
      return;
    }
  });

  try {
    chrome.runtime.sendMessage({ type: "CONTENT_READY", href: location.href });
  } catch {
    /* ignore */
  }

  window.__triarAutoExtension = {
    version: "1.2.0",
    booted: true,
    targets: TARGETS,
    probe: (key) => probe(key || "triar", 0),
    findTargetElement,
  };
})();
