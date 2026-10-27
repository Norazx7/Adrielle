/**
 * Cole no Console COM o chamado aberto.
 * Não precisa abrir a tarefa antes — o script clica em "Tarefa".
 */
(async () => {
  const CFG = {
    templateId: "15",
    stateId: "2",
    userId: "1077",
    groupId: "11",
    contentHtml: `<p>Executar a triagem do chamado. <strong>Lembre-se:</strong></p>
<ul>
<li>Atribuir a TAREFA para si (técnico encarregado do atendimento);</li>
<li>Alterar a data da TAREFA para o dia do atendimento caso necessário;</li>
</ul>
<p>Ao final da triagem do chamado, marcar como FEITO.</p>`,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function setVal(select, value) {
    if (!select) return false;
    const str = String(value);
    if (![...select.options].some((o) => String(o.value) === str)) {
      const o = document.createElement("option");
      o.value = str;
      o.textContent = str;
      select.appendChild(o);
    }
    select.value = str;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    if (window.jQuery) {
      const $el = window.jQuery(select);
      $el.val(str).trigger("change");
      $el.trigger("setValue", str);
    }
    return String(select.value) === str;
  }

  // Abre painel Tarefa
  if (!$('select[name="tasktemplates_id"]')) {
    const btn = $("button.answer-action.action-task") || $$("button").find((b) => (b.textContent || "").trim() === "Tarefa");
    if (!btn) {
      console.error('Botão "Tarefa" não encontrado');
      return;
    }
    btn.click();
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ($('select[name="tasktemplates_id"]')) break;
    }
  }

  const template = $('select[name="tasktemplates_id"]');
  const state = $('select[name="state"]');
  const user = $('select[name="users_id_tech"]');
  const group = $('select[name="groups_id_tech"]');

  console.log("set template", setVal(template, CFG.templateId));
  await sleep(600);
  console.log("set state", setVal(state, CFG.stateId));
  console.log("set user", setVal(user, CFG.userId));
  console.log("set group", setVal(group, CFG.groupId));

  const tech = user;
  const rand = (tech?.id || "").replace(/\D/g, "");
  const ed = rand && window.tinymce?.get?.(`content_${rand}`);
  if (ed) {
    ed.setContent(CFG.contentHtml);
    ed.fire("change");
    console.log("tinymce ok", rand);
  }

  const plan = $$("button").find((b) => /planejar esta tarefa/i.test(b.textContent || ""));
  const scope = plan?.closest("form, .card, .timeline-item, .itil-timeline-item") || document;
  const add = $$("button.btn-primary", scope).find((b) => /^\s*adicionar\s*$/i.test((b.textContent || "").trim()));
  if (add) {
    add.click();
    console.log("%cAdicionar clicado", "color:#2db49e;font-weight:bold");
  } else {
    console.warn("Botão Adicionar da tarefa não encontrado — preencheu os campos.");
  }

  return {
    template: template?.value,
    state: state?.value,
    user: user?.value,
    group: group?.value,
  };
})();
