(() => {
  if (window.__glpiTriagemAuto?.booted) return;

  const DEFAULTS = {
    contentHtml: `<p>Executar a triagem do chamado. <strong>Lembre-se:</strong></p>
<ul>
<li>Atribuir a TAREFA para si (técnico encarregado do atendimento);</li>
<li>Alterar a data da TAREFA para o dia do atendimento caso necessário;</li>
</ul>
<p>Ao final da triagem do chamado, marcar como FEITO.</p>`,
    templateText: "Realizar triagem",
    statusText: "Feito",
    statusValue: "2",
    userText: "witorio.couto",
    groupText: "DTI - CENTRAL TI - TRIAGEM",
    isPrivate: false,
    autoSubmit: true,
  };

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isGlpiTicketPage() {
    const href = location.href.toLowerCase();
    const path = location.pathname.toLowerCase();
    if (/ticket\.form\.php|ticket\.tabs|\/front\/ticket|\/ticket\//i.test(href + path)) return true;
    if (document.querySelector(".itil-timeline, #itil-data, form[name='form_ticket'], .timeline-item")) return true;
    if (document.body?.innerText?.includes("Adicionar uma nova tarefa")) return true;
    return false;
  }

  function normalize(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function textMatches(hay, needle) {
    const h = normalize(hay);
    const n = normalize(needle);
    return h === n || h.includes(n) || n.includes(h);
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findSelectByNames(names) {
    for (const name of names) {
      const el = document.querySelector(`select[name="${name}"], select[name^="${name}"], select[id*="${name}"]`);
      if (el) return el;
    }
    return null;
  }

  function findSelectNearLabel(labelHints) {
    const hints = labelHints.map(normalize);
    const labels = Array.from(document.querySelectorAll("label, .form-label, .col-form-label, span, div"));
    for (const lab of labels) {
      const t = normalize(lab.textContent || "");
      if (!hints.some((h) => t.includes(h))) continue;
      const forId = lab.getAttribute("for");
      if (forId) {
        const byFor = document.getElementById(forId);
        if (byFor?.tagName === "SELECT") return byFor;
      }
      const wrap = lab.closest(".form-field, .form-group, .field-container, .row, .mb-2, .mb-3") || lab.parentElement;
      const sel = wrap?.querySelector?.("select");
      if (sel) return sel;
    }
    return null;
  }

  function optionByText(select, wanted) {
    if (!select) return null;
    const opts = Array.from(select.options || []);
    return (
      opts.find((o) => textMatches(o.textContent, wanted)) ||
      opts.find((o) => textMatches(o.value, wanted)) ||
      null
    );
  }

  async function setSelectByText(select, wanted, preferredValue) {
    if (!select) return false;

    if (preferredValue != null) {
      const byVal = Array.from(select.options || []).find((o) => String(o.value) === String(preferredValue));
      if (byVal) {
        setNativeValue(select, byVal.value);
        if (window.jQuery) {
          try {
            window.jQuery(select).val(byVal.value).trigger("change");
          } catch {
            /* ignore */
          }
        }
        return true;
      }
    }

    const opt = optionByText(select, wanted);
    if (!opt) return false;

    setNativeValue(select, opt.value);
    if (window.jQuery) {
      try {
        window.jQuery(select).val(opt.value).trigger("change");
        // Select2 / GLPI setValue
        const id = select.id;
        if (id) window.jQuery(`#${CSS.escape(id)}`).trigger("setValue", opt.value);
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  async function setSelect2BySearch(select, wanted) {
    if (!select) return false;
    const $ = window.jQuery;
    if (!$ || !$.fn?.select2) {
      return setSelectByText(select, wanted);
    }

    try {
      const $el = $(select);
      // tenta abrir e filtrar
      $el.select2("open");
      await sleep(150);
      const search = document.querySelector(".select2-container--open .select2-search__field");
      if (search) {
        search.focus();
        search.value = wanted;
        search.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(350);
        const opt = document.querySelector(".select2-results__option--highlighted, .select2-results__option[aria-selected='true'], .select2-results__option");
        if (opt) {
          opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          await sleep(100);
          return true;
        }
      }
      $el.select2("close");
    } catch {
      /* fallback */
    }
    return setSelectByText(select, wanted);
  }

  function setTinyOrTextarea(html) {
    const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    // TinyMCE
    try {
      if (window.tinymce) {
        const editors = window.tinymce.get() || [];
        for (const ed of editors) {
          const id = ed.id || "";
          if (/content|task/i.test(id) || editors.length === 1) {
            ed.setContent(html);
            ed.fire("change");
            return true;
          }
        }
      }
    } catch {
      /* ignore */
    }

    const area =
      document.querySelector("textarea[name='content']") ||
      document.querySelector("textarea[name*='content']") ||
      document.querySelector(".tox-edit-area textarea") ||
      document.querySelector("textarea");

    if (area) {
      setNativeValue(area, html);
      // se for tinymce hidden, também tenta plain
      if (!area.value.includes("<")) setNativeValue(area, plain);
      return true;
    }
    return false;
  }

  function setPrivate(wantedPrivate) {
    const input =
      document.querySelector("input[name='is_private']") ||
      document.querySelector("input[data-testid='private-switch']") ||
      document.querySelector("input[type='checkbox'][name*='private']");
    if (!input) return false;
    const should = Boolean(wantedPrivate);
    if (input.type === "checkbox") {
      if (input.checked !== should) input.click();
      return true;
    }
    setNativeValue(input, should ? "1" : "0");
    return true;
  }

  async function openTaskForm() {
    // já aberto?
    if (
      document.querySelector("select[name='state'], select[name='users_id_tech'], textarea[name='content']") ||
      document.body.innerText.includes("Adicionar uma nova tarefa")
    ) {
      return true;
    }

    const candidates = Array.from(
      document.querySelectorAll("a, button, .btn, [role='button'], .itil-timeline button, .timeline-buttons a")
    );
    const btn = candidates.find((el) => {
      const t = normalize(el.textContent || el.getAttribute("title") || "");
      return (
        t.includes("adicionar uma nova tarefa") ||
        t.includes("nova tarefa") ||
        (t.includes("tarefa") && t.includes("adicionar")) ||
        t === "tarefa"
      );
    });

    if (btn) {
      btn.click();
      for (let i = 0; i < 25; i += 1) {
        await sleep(200);
        if (document.querySelector("select[name='users_id_tech'], select[name='state'], textarea[name='content']")) {
          return true;
        }
      }
    }
    return false;
  }

  async function fillTask(cfg) {
    const config = { ...DEFAULTS, ...cfg };
    const opened = await openTaskForm();
    if (!opened && !document.querySelector("select[name='users_id_tech'], select[name='state']")) {
      return {
        ok: false,
        message: "Abra o chamado e a tela de Adicionar tarefa, depois clique de novo.",
      };
    }

    await sleep(250);

    // Template (se existir na lista)
    const templateSelect =
      findSelectByNames(["tasktemplates_id", "_tasktemplates_id"]) ||
      findSelectNearLabel(["modelo", "template", "realizar triagem"]);
    if (templateSelect) {
      await setSelect2BySearch(templateSelect, config.templateText);
      await sleep(400); // GLPI pode auto-preencher pelo template
    }

    // Conteúdo (garante o texto mesmo se template não existir)
    setTinyOrTextarea(config.contentHtml);

    // Status Feito
    const stateSelect = findSelectByNames(["state"]) || findSelectNearLabel(["status", "estado"]);
    await setSelectByText(stateSelect, config.statusText, config.statusValue);

    // Técnico
    const userSelect =
      findSelectByNames(["users_id_tech"]) || findSelectNearLabel(["tecnico", "por", "usuario", "user"]);
    const userOk = await setSelect2BySearch(userSelect, config.userText);

    // Grupo
    const groupSelect =
      findSelectByNames(["groups_id_tech"]) || findSelectNearLabel(["grupo", "group"]);
    const groupOk = await setSelect2BySearch(groupSelect, config.groupText);

    setPrivate(config.isPrivate);

    // Reaplica conteúdo/status depois do template (template pode sobrescrever)
    await sleep(200);
    setTinyOrTextarea(config.contentHtml);
    await setSelectByText(stateSelect, config.statusText, config.statusValue);
    if (!userOk) await setSelect2BySearch(userSelect, config.userText);
    if (!groupOk) await setSelect2BySearch(groupSelect, config.groupText);

    let submitted = false;
    if (config.autoSubmit) {
      const addBtn = Array.from(document.querySelectorAll("button, input[type='submit'], a.btn")).find((el) => {
        const t = normalize(el.textContent || el.value || "");
        return t.includes("adicionar") && !t.includes("arquivo");
      });
      if (addBtn) {
        addBtn.click();
        submitted = true;
      }
    }

    return {
      ok: true,
      submitted,
      userOk,
      groupOk,
      message: submitted
        ? "Tarefa preenchida e enviada (Adicionar)."
        : "Tarefa preenchida. Confira e clique em Adicionar se precisar.",
    };
  }

  function ensureFab() {
    if (!isGlpiTicketPage()) return;
    if (document.getElementById("glpi-triagem-fab")) return;

    const fab = document.createElement("button");
    fab.id = "glpi-triagem-fab";
    fab.type = "button";
    fab.title = "Preencher tarefa de triagem";
    fab.textContent = "TRIAGEM";
    fab.addEventListener("click", async () => {
      fab.disabled = true;
      fab.textContent = "...";
      try {
        const stored = await chrome.storage.local.get(DEFAULTS);
        const result = await fillTask(stored);
        fab.textContent = result.ok ? "OK" : "ERRO";
        fab.title = result.message;
      } catch (err) {
        fab.textContent = "ERRO";
        fab.title = String(err?.message || err);
      }
      setTimeout(() => {
        fab.disabled = false;
        fab.textContent = "TRIAGEM";
      }, 1600);
    });
    document.documentElement.appendChild(fab);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) return;
    if (message.type === "PING") {
      sendResponse({ ok: true, glpi: isGlpiTicketPage(), href: location.href });
      return;
    }
    if (message.type === "FILL_TRIAGEM") {
      fillTask(message.config || {}).then(sendResponse);
      return true;
    }
  });

  ensureFab();
  const mo = new MutationObserver(() => ensureFab());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  window.__glpiTriagemAuto = {
    booted: true,
    version: "1.0.0",
    fillTask,
  };
})();
