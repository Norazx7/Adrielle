(() => {
  // Roda no MAIN world (mesmo JS do GLPI / jQuery / TinyMCE / Select2)
  if (window.__glpiTriagemPageFill?.booted) {
    window.__glpiTriagemPageFill.run();
    return;
  }

  const CFG = {
    templateId: "15",
    templateText: "Realizar triagem",
    stateId: "2",
    stateText: "Feito",
    userId: "1070",
    userText: "guilherme.apinheiro",
    groupId: "11",
    groupText: "DTI - CENTRAL TI - TRIAGEM",
    contentHtml: `<p>Executar a triagem do chamado. <strong>Lembre-se:</strong></p>
<ul>
<li>Atribuir a TAREFA para si (técnico encarregado do atendimento);</li>
<li>Alterar a data da TAREFA para o dia do atendimento caso necessário;</li>
</ul>
<p>Ao final da triagem do chamado, marcar como FEITO.</p>`,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const logs = [];

  function log(msg, data) {
    const line = data !== undefined ? `${msg} ${JSON.stringify(data)}` : msg;
    logs.push(line);
    console.log("%c[TRIAGEM]", "color:#e10600;font-weight:bold", msg, data ?? "");
    const box = document.getElementById("glpi-triagem-log");
    if (box) box.textContent = logs.slice(-12).join("\n");
  }

  function ensureLogBox() {
    let box = document.getElementById("glpi-triagem-log");
    if (box) return box;
    box = document.createElement("pre");
    box.id = "glpi-triagem-log";
    box.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:420px;max-height:220px;overflow:auto;background:#111;color:#fff;padding:10px;border:2px solid #e10600;border-radius:10px;font:12px/1.35 monospace;white-space:pre-wrap;";
    document.documentElement.appendChild(box);
    return box;
  }

  function q(sel, root = document) {
    return root.querySelector(sel);
  }

  function qa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  }

  async function openTask() {
    if (q('select[name="tasktemplates_id"]') && visible(q('select[name="tasktemplates_id"]')?.nextElementSibling || q('select[name="tasktemplates_id"]'))) {
      log("Formulário de tarefa já aberto");
      return true;
    }

    const btn =
      q("button.answer-action.action-task") ||
      qa("button").find((b) => (b.textContent || "").replace(/\s+/g, " ").trim() === "Tarefa");

    if (!btn) {
      log("ERRO: botão Tarefa não encontrado");
      return false;
    }

    log("Clicando no botão Tarefa");
    btn.click();

    for (let i = 0; i < 50; i += 1) {
      await sleep(100);
      const sel = q('select[name="tasktemplates_id"]');
      if (sel) {
        log("Select tasktemplates_id apareceu", { id: sel.id });
        return true;
      }
    }
    log("ERRO: tasktemplates_id não apareceu após clicar em Tarefa");
    return false;
  }

  function getSelect2Container(select) {
    if (!select?.id) return select?.nextElementSibling;
    return (
      document.getElementById(`select2-${select.id}-container`)?.closest(".select2-container") ||
      select.nextElementSibling ||
      select.parentElement?.querySelector(".select2-container")
    );
  }

  async function pickByClick(select, { value, text }) {
    if (!select) {
      log("pickByClick: select ausente", { text });
      return false;
    }

    const $ = window.jQuery;

    // Tentativa 1: API GLPI setValue
    if ($) {
      try {
        $(select).trigger("setValue", value);
        await sleep(200);
        if (String(select.value) === String(value)) {
          log("OK via setValue", { name: select.name, value });
          return true;
        }
      } catch (e) {
        log("setValue falhou", String(e));
      }

      try {
        $(select).val(String(value)).trigger("change");
        await sleep(200);
        if (String(select.value) === String(value)) {
          log("OK via jQuery val+change", { name: select.name, value });
          return true;
        }
      } catch (e) {
        log("val+change falhou", String(e));
      }
    }

    // Tentativa 2: clicar no Select2 visível
    const container = getSelect2Container(select);
    const selection =
      container?.querySelector?.(".select2-selection") ||
      document.getElementById(`select2-${select.id}-container`);

    if (!selection) {
      log("Select2 container não encontrado, forçando value nativo", { name: select.name });
      select.value = String(value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return String(select.value) === String(value);
    }

    log("Abrindo Select2", { name: select.name, text });
    selection.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    selection.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    selection.click();
    await sleep(250);

    const search = q(".select2-container--open .select2-search__field");
    if (search) {
      search.focus();
      search.value = text;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      if ($) $(search).val(text).trigger("input").trigger("keyup");
      await sleep(400);
    }

    const options = qa(".select2-results__option");
    log("Opções Select2", options.map((o) => (o.textContent || "").trim()).slice(0, 8));

    const opt =
      options.find((o) => (o.textContent || "").trim() === text) ||
      options.find((o) => (o.textContent || "").includes(text)) ||
      options.find((o) => (o.id || "").includes(`-${value}`));

    if (!opt) {
      log("ERRO: opção não encontrada no Select2", { text, value });
      // fecha
      document.activeElement?.blur?.();
      return false;
    }

    opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    opt.click();
    await sleep(300);

    const ok = String(select.value) === String(value) || (select.selectedOptions?.[0]?.textContent || "").includes(text);
    log(ok ? "OK via clique Select2" : "FALHA clique Select2", {
      name: select.name,
      value: select.value,
      selectedText: select.selectedOptions?.[0]?.textContent?.trim(),
    });
    return ok;
  }

  function setContent() {
    const userSel = q('select[name="users_id_tech"]');
    const rand = (userSel?.id || "").replace(/\D/g, "");
    const editorId = rand ? `content_${rand}` : null;
    log("TinyMCE alvo", { editorId, hasTinymce: Boolean(window.tinymce) });

    try {
      if (editorId && window.tinymce?.get) {
        const ed = window.tinymce.get(editorId);
        if (ed) {
          ed.setContent(CFG.contentHtml);
          ed.fire("change");
          log("TinyMCE preenchido");
          return true;
        }
      }
    } catch (e) {
      log("TinyMCE erro", String(e));
    }

    const ta = editorId ? document.getElementById(editorId) : q('textarea[name="content"]');
    if (ta) {
      ta.value = CFG.contentHtml;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      log("textarea content preenchida");
      return true;
    }
    log("ERRO: não achou editor de conteúdo");
    return false;
  }

  function clickAdd() {
    const plan = qa("button").find((b) => /planejar esta tarefa/i.test(b.textContent || ""));
    const scope =
      plan?.closest("form, .card, .timeline-item, .itil-timeline-item, .tab-content") || document;

    const candidates = qa("button.btn-primary", scope).filter((b) =>
      /^\s*adicionar\s*$/i.test((b.textContent || "").trim())
    );

    log(
      "Botões Adicionar no escopo",
      candidates.map((b) => (b.textContent || "").trim())
    );

    const add = candidates[0];
    if (!add) {
      log("ERRO: botão Adicionar da tarefa não encontrado");
      return false;
    }
    add.click();
    log("Clique em Adicionar enviado");
    return true;
  }

  async function run(opts = {}) {
    ensureLogBox();
    logs.length = 0;
    log("Iniciando preenchimento…", { href: location.href });

    if (!/ticket\.form\.php/i.test(location.href)) {
      log("AVISO: URL não parece ticket.form.php");
    }

    const opened = await openTask();
    if (!opened) return { ok: false, logs: [...logs] };

    await sleep(300);

    const template = q('select[name="tasktemplates_id"]');
    const state = q('select[name="state"]');
    const user = q('select[name="users_id_tech"]');
    const group = q('select[name="groups_id_tech"]');

    log("Selects", {
      template: template?.id,
      state: state?.id,
      user: user?.id,
      group: group?.id,
      jq: Boolean(window.jQuery),
    });

    await pickByClick(template, { value: CFG.templateId, text: CFG.templateText });
    await sleep(700); // AJAX do template GLPI
    await pickByClick(state, { value: CFG.stateId, text: CFG.stateText });
    await pickByClick(user, { value: CFG.userId, text: CFG.userText });
    await pickByClick(group, { value: CFG.groupId, text: CFG.groupText });
    setContent();

    const priv = q('input[type="checkbox"][name="is_private"]');
    if (priv?.checked) {
      priv.click();
      log("Privada desmarcada");
    }

    let submitted = false;
    if (opts.autoSubmit !== false) {
      await sleep(200);
      submitted = clickAdd();
    }

    const result = {
      ok: true,
      submitted,
      values: {
        template: template?.value,
        state: state?.value,
        user: user?.value,
        group: group?.value,
      },
      logs: [...logs],
    };
    log("FINAL", result.values);
    window.__glpiTriagemLastResult = result;
    return result;
  }

  window.__glpiTriagemPageFill = { booted: true, run, CFG };
  window.__glpiTriagemPageFill.run();
})();
