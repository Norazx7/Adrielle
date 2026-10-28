/**
 * COLE NO CONSOLE do chamado GLPI (F12).
 * Vai aparecer um quadrado preto com o log do que está acontecendo.
 * Se falhar, copie o texto desse quadrado e me envie.
 */
(async () => {
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
  let box = document.getElementById("glpi-triagem-log");
  if (!box) {
    box = document.createElement("pre");
    box.id = "glpi-triagem-log";
    box.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:460px;max-height:260px;overflow:auto;background:#111;color:#fff;padding:10px;border:2px solid #e10600;border-radius:10px;font:12px/1.35 monospace;white-space:pre-wrap;";
    document.documentElement.appendChild(box);
  }
  const log = (m, d) => {
    const line = d !== undefined ? m + " " + JSON.stringify(d) : m;
    logs.push(line);
    box.textContent = logs.join("\n");
    console.log("[TRIAGEM]", m, d ?? "");
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  log("jQuery?", !!window.jQuery);
  log("tinymce?", !!window.tinymce);
  log("url", location.href);

  // Abrir Tarefa
  if (!$('select[name="tasktemplates_id"]')) {
    const btn = $("button.answer-action.action-task") || $$("button").find((b) => (b.textContent || "").trim() === "Tarefa");
    if (!btn) {
      log("ERRO: botão Tarefa não achado");
      return logs;
    }
    log("clique Tarefa");
    btn.click();
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      if ($('select[name="tasktemplates_id"]')) break;
    }
  }

  const template = $('select[name="tasktemplates_id"]');
  const state = $('select[name="state"]');
  const user = $('select[name="users_id_tech"]');
  const group = $('select[name="groups_id_tech"]');
  log("selects", {
    template: !!template && template.id,
    state: !!state && state.id,
    user: !!user && user.id,
    group: !!group && group.id,
  });
  if (!template) {
    log("ERRO: formulário não abriu");
    return logs;
  }

  async function pick(select, value, text) {
    if (!select) return false;
    const jq = window.jQuery;
    if (jq) {
      try {
        jq(select).trigger("setValue", value);
        await sleep(200);
        if (String(select.value) === String(value)) {
          log("OK setValue", { name: select.name, value });
          return true;
        }
      } catch (e) {
        log("setValue erro", String(e));
      }
      try {
        jq(select).val(String(value)).trigger("change");
        await sleep(200);
        if (String(select.value) === String(value)) {
          log("OK val+change", { name: select.name, value });
          return true;
        }
      } catch (e) {
        log("val+change erro", String(e));
      }
    }

    const container =
      document.getElementById(`select2-${select.id}-container`) ||
      select.nextElementSibling?.querySelector?.(".select2-selection") ||
      select.parentElement?.querySelector(".select2-selection");
    if (!container) {
      select.value = String(value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      log("force native", { name: select.name, value: select.value });
      return String(select.value) === String(value);
    }

    const selection = container.classList?.contains("select2-selection")
      ? container
      : container.querySelector?.(".select2-selection") || container;

    log("abrindo select2", text);
    selection.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, view: window }));
    selection.click();
    await sleep(250);

    const search = $(".select2-container--open .select2-search__field");
    if (search) {
      search.focus();
      search.value = text;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(450);
    }

    const opts = $$(".select2-results__option");
    log(
      "opções",
      opts.map((o) => (o.textContent || "").trim()).slice(0, 10)
    );
    const opt =
      opts.find((o) => (o.textContent || "").trim() === text) ||
      opts.find((o) => (o.textContent || "").includes(text));
    if (!opt) {
      log("ERRO opção não encontrada", text);
      return false;
    }
    opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, view: window }));
    opt.click();
    await sleep(300);
    log("depois clique", { name: select.name, value: select.value, text: select.selectedOptions?.[0]?.textContent?.trim() });
    return String(select.value) === String(value) || (select.selectedOptions?.[0]?.textContent || "").includes(text);
  }

  await pick(template, CFG.templateId, CFG.templateText);
  await sleep(800);
  await pick(state, CFG.stateId, CFG.stateText);
  await pick(user, CFG.userId, CFG.userText);
  await pick(group, CFG.groupId, CFG.groupText);

  const rand = (user?.id || "").replace(/\D/g, "");
  const ed = rand && window.tinymce?.get?.(`content_${rand}`);
  if (ed) {
    ed.setContent(CFG.contentHtml);
    ed.fire("change");
    log("tinymce ok", rand);
  } else log("tinymce não achado", rand);

  const plan = $$("button").find((b) => /planejar esta tarefa/i.test(b.textContent || ""));
  const scope = plan?.closest("form, .card, .timeline-item, .itil-timeline-item") || document;
  const add = $$("button.btn-primary", scope).find((b) => /^\s*adicionar\s*$/i.test((b.textContent || "").trim()));
  if (add) {
    add.click();
    log("Adicionar clicado");
  } else log("ERRO Adicionar não achado");

  log("FINAL", {
    template: template.value,
    state: state.value,
    user: user.value,
    group: group.value,
  });

  try {
    await navigator.clipboard.writeText(logs.join("\n"));
    log("Log copiado na área de transferência");
  } catch {}

  return logs;
})();
