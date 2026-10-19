(() => {
  if (window.__triarAutoExtension?.booted) return;

  const DEFAULT_WAIT_MS = 90000;

  const TARGETS = {
    triar: {
      key: "triar",
      name: "TRIAR PROCESSOS",
      selectors: [
        '[data-otel-label="TRIAR_NIVEL_12"]',
        '[data-otel-label*="TRIAR" i]',
        '#B68314861501381838',
      ],
      texts: ["TRIAR PROCESSOS", "TRIAR PROCESSO"],
    },
    despacho: {
      key: "despacho",
      name: "Criar Despacho",
      selectors: [
        '[data-otel-label*="DESPACHO" i]',
        '[data-otel-label*="CRIAR_DESPACHO" i]',
      ],
      texts: ["CRIAR DESPACHO", "CRIACAO DE DESPACHO", "CRIAÇÃO DE DESPACHO"],
    },
  };

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function getTarget(targetKey) {
    return TARGETS[targetKey] || TARGETS.triar;
  }

  function isProbablyVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      // Aceita mesmo fora da viewport (só precisa existir e ter tamanho)
      return rect.width > 0 && rect.height > 0;
    } catch {
      return true;
    }
  }

  function rawText(el) {
    if (!el) return "";
    try {
      const label = el.querySelector?.(":scope > .t-Button-label, .t-Button-label");
      if (label?.textContent) return label.textContent;
      return (
        el.getAttribute?.("data-otel-label") ||
        el.getAttribute?.("title") ||
        el.getAttribute?.("aria-label") ||
        el.textContent ||
        ""
      );
    } catch {
      return el.textContent || "";
    }
  }

  function matchesTexts(el, texts) {
    const text = normalizeText(rawText(el));
    if (!text) return false;
    return texts.some((t) => text.includes(normalizeText(t)));
  }

  function findClickable(el) {
    if (!el) return null;
    if (el.matches?.("button, a, input[type='button'], input[type='submit'], [role='button'], .t-Button")) {
      return el;
    }
    const closest = el.closest?.("button, a, .t-Button, [role='button'], [onclick]");
    return closest || el;
  }

  function scoreCandidate(el, target) {
    let score = 0;
    if (!el) return -1;
    if (matchesTexts(el, target.texts)) score += 50;
    if (el.matches?.("button, .t-Button, a.t-Button")) score += 20;
    if (el.querySelector?.(".t-Button-label")) score += 15;
    if (isProbablyVisible(el)) score += 25;
    if (el.disabled || el.getAttribute?.("aria-disabled") === "true") score -= 40;
    const id = el.id || "";
    const otel = el.getAttribute?.("data-otel-label") || "";
    if (target.key === "triar" && /TRIAR/i.test(otel + id)) score += 30;
    if (target.key === "despacho" && /DESPACHO/i.test(otel + id)) score += 30;
    return score;
  }

  function collectFromDocument(doc, target) {
    if (!doc) return [];
    const found = [];

    // 1) Seletores específicos
    for (const selector of target.selectors) {
      try {
        doc.querySelectorAll(selector).forEach((el) => found.push(el));
      } catch {
        /* ignore */
      }
    }

    // 2) Todos os labels de botão APEX
    try {
      doc.querySelectorAll(".t-Button-label").forEach((label) => {
        if (matchesTexts(label, target.texts)) found.push(label);
      });
    } catch {
      /* ignore */
    }

    // 3) Botões / links genéricos
    try {
      doc.querySelectorAll("button, a, .t-Button, [role='button'], input[type='button']").forEach((el) => {
        if (matchesTexts(el, target.texts)) found.push(el);
      });
    } catch {
      /* ignore */
    }

    // 4) Varredura por texto (TreeWalker) — último recurso
    try {
      const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        if (node.childElementCount === 0 || node.classList?.contains("t-Button-label")) {
          if (matchesTexts(node, target.texts)) found.push(node);
        }
        node = walker.nextNode();
      }
    } catch {
      /* ignore */
    }

    return found;
  }

  function unique(nodes) {
    return Array.from(new Set(nodes.filter(Boolean)));
  }

  function findInDocument(doc, target) {
    const candidates = unique(collectFromDocument(doc, target))
      .map((el) => findClickable(el))
      .filter(Boolean);

    if (!candidates.length) return null;

    candidates.sort((a, b) => scoreCandidate(b, target) - scoreCandidate(a, target));
    const best = candidates[0];
    return scoreCandidate(best, target) > 0 ? best : null;
  }

  function listSameOriginDocs(rootDoc = document, depth = 0, acc = []) {
    if (!rootDoc || depth > 10) return acc;
    acc.push(rootDoc);
    let frames = [];
    try {
      frames = Array.from(rootDoc.querySelectorAll("iframe, frame"));
    } catch {
      return acc;
    }
    for (const frame of frames) {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (doc) listSameOriginDocs(doc, depth + 1, acc);
      } catch {
        /* cross-origin */
      }
    }
    return acc;
  }

  function findTargetElement(targetKey) {
    const target = getTarget(targetKey);
    const docs = listSameOriginDocs(document);
    let best = null;
    let bestScore = -1;
    for (const doc of docs) {
      const el = findInDocument(doc, target);
      if (!el) continue;
      const score = scoreCandidate(el, target);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
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
        try {
          observer.disconnect();
        } catch {
          /* ignore */
        }
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
          characterData: true,
        });
      } catch {
        /* ignore */
      }

      // Observa iframes same-origin que carregarem depois
      const poll = setInterval(check, 300);
      check();
    });
  }

  function clickElement(el) {
    const win = el.ownerDocument?.defaultView || window;

    try {
      el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
    } catch {
      try {
        el.scrollIntoView(true);
      } catch {
        /* ignore */
      }
    }

    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }

    // Simula interação real do APEX (jQuery/apex.event)
    const base = { bubbles: true, cancelable: true, view: win, buttons: 1, composed: true };
    for (const type of ["pointerover", "mouseover", "pointerenter", "mouseenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        el.dispatchEvent(new MouseEvent(type, base));
      } catch {
        /* ignore */
      }
    }

    try {
      if (typeof el.click === "function") el.click();
    } catch {
      /* ignore */
    }

    // Fallback APEX: se houver id, tenta apex.event.trigger
    try {
      if (el.id && win.apex?.event?.trigger) {
        win.apex.event.trigger(`#${CSS.escape(el.id)}`, "click");
      }
    } catch {
      /* ignore */
    }

    // Fallback jQuery
    try {
      if (win.jQuery) win.jQuery(el).trigger("click");
    } catch {
      /* ignore */
    }
  }

  function flashFeedback(el) {
    try {
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = "3px solid #e10600";
      el.style.outlineOffset = "4px";
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.outlineOffset = prevOffset;
      }, 1200);
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
        found: false,
        targetKey: target.key,
        frameHref: location.href,
        message: `"${target.name}" não encontrado neste frame.`,
      };
    }

    if (el.disabled || el.getAttribute("aria-disabled") === "true") {
      return {
        ok: false,
        found: true,
        targetKey: target.key,
        frameHref: location.href,
        label: rawText(el).trim(),
        message: `"${target.name}" encontrado, mas está desabilitado.`,
      };
    }

    clickElement(el);
    flashFeedback(el);

    return {
      ok: true,
      found: true,
      targetKey: target.key,
      buttonId: el.id || null,
      label: rawText(el).trim(),
      frameHref: location.href,
      expectsReload: true,
      message: `Clique em "${rawText(el).trim() || target.name}" OK.`,
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
      label: el ? rawText(el).trim() : null,
      disabled: el ? Boolean(el.disabled || el.getAttribute("aria-disabled") === "true") : null,
      frameHref: location.href,
      visible: el ? isProbablyVisible(el) : false,
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

    if (message.type === "PING") {
      sendResponse({
        ok: true,
        href: location.href,
        isTop: window.top === window,
        version: "1.3.0",
      });
      return;
    }
  });

  try {
    chrome.runtime.sendMessage({
      type: "CONTENT_READY",
      href: location.href,
      isTop: window.top === window,
    });
  } catch {
    /* ignore */
  }

  window.__triarAutoExtension = {
    version: "1.3.0",
    booted: true,
    targets: TARGETS,
    findTargetElement,
    probe: (key) => probe(key || "triar", 0),
  };
})();
