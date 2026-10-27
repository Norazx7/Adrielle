(() => {
  if (window.__glpiTriagemAuto?.booted) return;

  // Calibrado no helpdesk.detran.go.gov.br (ticket.form.php)
  const CFG = {
    templateId: "15",
    templateText: "Realizar triagem",
    stateId: "2",
    stateText: "Feito",
    userId: "1077",
    userText: "witorio.couto",
    groupId: "11",
    groupText: "DTI - CENTRAL TI - TRIAGEM",
    contentHtml: `<p>Executar a triagem do chamado. <strong>Lembre-se:</strong></p>
<ul>
<li>Atribuir a TAREFA para si (técnico encarregado do atendimento);</li>
<li>Alterar a data da TAREFA para o dia do atendimento caso necessário;</li>
</ul>
<p>Ao final da triagem do chamado, marcar como FEITO.</p>`,
    autoSubmit: true,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function isTicketPage() {
    return /ticket\.form\.php/i.test(location.href) || Boolean($(".itil-timeline, .timeline-item, .action-task"));
  }

  function getTaskFormRoot() {
    const tech = $('select[name="users_id_tech"]');
    if (!tech) return null;
    return (
      tech.closest("form") ||
      tech.closest(".itil-timeline-item, .timeline-item, .card, .tab-pane, .row") ||
      tech.parentElement?.parentElement ||
      document
    );
  }

  function glpiSetValue(select, value) {
    if (!select) return false;
    const str = String(value);
    const $jq = window.jQuery;

    // Garante option existente (Select2 AJAX às vezes não tem)
    if (![...select.options].some((o) => String(o.value) === str)) {
      const opt = document.createElement("option");
      opt.value = str;
      opt.textContent = str;
      select.appendChild(opt);
    }

    select.value = str;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    if ($jq) {
      try {
        const $el = $jq(select);
        $el.val(str).trigger("change");
        // API nativa GLPI
        $el.trigger("setValue", str);
        if (select.id) $jq(`#${CSS.escape(select.id)}`).trigger("setValue", str);
      } catch {
        /* ignore */
      }
    }
    return String(select.value) === str;
  }

  function setTinyByIdOrTask(html) {
    const root = getTaskFormRoot();
    const ta =
      (root && root.querySelector?.('textarea[name="content"]')) ||
      $('textarea[id^="content_"][name="content"]') ||
      $all('textarea[name="content"]').find((t) => {
        const id = t.id || "";
        // o form de tarefa costuma compartilhar o mesmo rand do select users_id_tech
        const tech = $('select[name="users_id_tech"]');
        return tech?.id && id.includes(String(tech.id).replace(/\D/g, "").slice(-6));
      }) ||
      $all('textarea[name="content"]').find((t) => /content_\d+/.test(t.id || ""));

    const targetId = ta?.id;
    try {
      if (window.tinymce?.get && targetId) {
        const ed = window.tinymce.get(targetId);
        if (ed) {
          ed.setContent(html);
          ed.fire("change");
          return true;
        }
      }
      // fallback: editor ligado ao select de tarefa
      if (window.tinymce?.get) {
        const tech = $('select[name="users_id_tech"]');
        const rand = (tech?.id || "").replace(/\D/g, "");
        const ed = rand ? window.tinymce.get(`content_${rand}`) : null;
        if (ed) {
          ed.setContent(html);
          ed.fire("change");
          return true;
        }
      }
    } catch {
      /* ignore */
    }

    if (ta) {
      ta.value = html;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  async function openTaskPanel() {
    if ($('select[name="tasktemplates_id"]') && $('select[name="users_id_tech"]')) {
      return true;
    }

    const btn =
      $("button.answer-action.action-task") ||
      $all("button, a").find((el) => {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        return t === "Tarefa" || /^tarefa$/i.test(t);
      });

    if (!btn) return false;
    btn.click();

    for (let i = 0; i < 40; i += 1) {
      await sleep(150);
      if ($('select[name="tasktemplates_id"]') && $('select[name="users_id_tech"]')) return true;
    }
    return false;
  }

  async function waitForTemplateApply() {
    for (let i = 0; i < 30; i += 1) {
      const state = $('select[name="state"]')?.value;
      const user = $('select[name="users_id_tech"]')?.value;
      const group = $('select[name="groups_id_tech"]')?.value;
      let content = "";
      try {
        const tech = $('select[name="users_id_tech"]');
        const rand = (tech?.id || "").replace(/\D/g, "");
        const ed = rand && window.tinymce?.get ? window.tinymce.get(`content_${rand}`) : null;
        content = ed?.getContent?.() || "";
      } catch {
        /* ignore */
      }
      if (state === CFG.stateId || user === CFG.userId || /triagem/i.test(content)) {
        return true;
      }
      await sleep(150);
    }
    return false;
  }

  function clickTaskAdd() {
    const plan = $all("button").find((b) => /planejar esta tarefa/i.test(b.textContent || ""));
    const scope =
      plan?.closest("form, .card, .itil-timeline-item, .timeline-item, .tab-content, .row") ||
      getTaskFormRoot() ||
      document;

    const buttons = $all("button.btn-primary, button.btn.btn-primary", scope);
    let add =
      buttons.find((b) => /^\s*adicionar\s*$/i.test((b.textContent || "").trim())) ||
      $all("button.btn-primary").find((b) => /^\s*adicionar\s*$/i.test((b.textContent || "").trim()));

    // evita botões de outros painéis
    if (add && /arquivo|ator|documento/i.test(add.textContent || "")) add = null;

    if (!add && plan) {
      // irmão próximo do plano
      const parent = plan.parentElement;
      add = $all("button", parent?.parentElement || document).find((b) =>
        /^\s*adicionar\s*$/i.test((b.textContent || "").trim())
      );
    }

    if (!add) return false;
    add.click();
    return true;
  }

  async function fillTask(overrides = {}) {
    const cfg = { ...CFG, ...overrides };
    const opened = await openTaskPanel();
    if (!opened) {
      return {
        ok: false,
        message: 'Clique em "Tarefa" no chamado e rode de novo.',
      };
    }

    await sleep(200);

    const template = $('select[name="tasktemplates_id"]');
    const state = $('select[name="state"]');
    const user = $('select[name="users_id_tech"]');
    const group = $('select[name="groups_id_tech"]');

    // 1) Modelo "Realizar triagem" (id 15) — no teu GLPI isso já preenche quase tudo
    const templateOk = glpiSetValue(template, cfg.templateId);
    await waitForTemplateApply();

    // 2) Força os campos (caso o AJAX do template falhe/atraso)
    const stateOk = glpiSetValue(state, cfg.stateId);
    const userOk = glpiSetValue(user, cfg.userId);
    const groupOk = glpiSetValue(group, cfg.groupId);
    const contentOk = setTinyByIdOrTask(cfg.contentHtml);

    // privada off
    const priv = $('input[type="checkbox"][name="is_private"]');
    if (priv?.checked) priv.click();

    await sleep(150);

    let submitted = false;
    if (cfg.autoSubmit !== false) {
      submitted = clickTaskAdd();
    }

    const ok = templateOk || (stateOk && userOk && groupOk);
    return {
      ok,
      submitted,
      details: { templateOk, stateOk, userOk, groupOk, contentOk },
      values: {
        tasktemplates_id: template?.value || null,
        state: state?.value || null,
        users_id_tech: user?.value || null,
        groups_id_tech: group?.value || null,
      },
      message: !ok
        ? "Não consegui setar os campos Select2 do GLPI."
        : submitted
          ? "Triagem preenchida e Adicionar clicado."
          : "Triagem preenchida. Clique em Adicionar se precisar.",
    };
  }

  function ensureFab() {
    if (!isTicketPage()) return;
    if ($("#glpi-triagem-fab")) return;
    const fab = document.createElement("button");
    fab.id = "glpi-triagem-fab";
    fab.type = "button";
    fab.textContent = "TRIAGEM";
    fab.title = "Preencher tarefa Realizar triagem";
    fab.addEventListener("click", async () => {
      fab.disabled = true;
      fab.textContent = "...";
      try {
        const stored = await chrome.storage.local.get({ autoSubmit: true });
        const result = await fillTask({ autoSubmit: stored.autoSubmit !== false });
        fab.textContent = result.ok ? "OK" : "ERRO";
        fab.title = result.message;
        console.log("[GLPI Triagem Auto]", result);
      } catch (err) {
        fab.textContent = "ERRO";
        fab.title = String(err?.message || err);
      }
      setTimeout(() => {
        fab.disabled = false;
        fab.textContent = "TRIAGEM";
      }, 1800);
    });
    document.documentElement.appendChild(fab);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ ok: true, ticket: isTicketPage(), href: location.href });
      return;
    }
    if (message?.type === "FILL_TRIAGEM") {
      fillTask(message.config || {}).then(sendResponse);
      return true;
    }
  });

  ensureFab();
  new MutationObserver(() => ensureFab()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.__glpiTriagemAuto = { booted: true, version: "1.1.0", fillTask, CFG };
})();
