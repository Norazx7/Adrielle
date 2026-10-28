/**
 * Cole este código no Console do Chrome (F12 → Console)
 * COM a tela/modal "Adicionar uma nova tarefa" ABERTA no GLPI.
 * Depois copie TODO o JSON impresso e me envie.
 */
(async () => {
  const out = {
    url: location.href,
    title: document.title,
    generatedAt: new Date().toISOString(),
    selects: [],
    inputs: [],
    textareas: [],
    buttons: [],
    tinymce: [],
    visibleTextHits: [],
  };

  function snapOptions(sel, limit = 40) {
    return Array.from(sel.options || [])
      .slice(0, limit)
      .map((o) => ({
        value: o.value,
        text: (o.textContent || "").trim(),
        selected: o.selected,
      }));
  }

  document.querySelectorAll("select").forEach((sel, i) => {
    const rect = sel.getBoundingClientRect();
    out.selects.push({
      i,
      name: sel.name || null,
      id: sel.id || null,
      className: sel.className || null,
      visible: rect.width > 0 && rect.height > 0,
      selectedValue: sel.value,
      selectedText: sel.selectedOptions?.[0]?.textContent?.trim() || null,
      optionsSample: snapOptions(sel),
      optionsCount: sel.options?.length || 0,
    });
  });

  document.querySelectorAll("input").forEach((inp, i) => {
    const rect = inp.getBoundingClientRect();
    if (inp.type === "hidden" && !/private|state|user|group|template|content|task/i.test(inp.name + inp.id)) {
      return;
    }
    out.inputs.push({
      i,
      type: inp.type,
      name: inp.name || null,
      id: inp.id || null,
      value: inp.type === "password" ? "(hidden)" : String(inp.value || "").slice(0, 200),
      checked: inp.type === "checkbox" || inp.type === "radio" ? inp.checked : undefined,
      visible: rect.width > 0 && rect.height > 0,
      placeholder: inp.placeholder || null,
    });
  });

  document.querySelectorAll("textarea").forEach((ta, i) => {
    const rect = ta.getBoundingClientRect();
    out.textareas.push({
      i,
      name: ta.name || null,
      id: ta.id || null,
      visible: rect.width > 0 && rect.height > 0,
      valuePreview: String(ta.value || "").slice(0, 300),
    });
  });

  document.querySelectorAll("button, a.btn, input[type='submit']").forEach((btn, i) => {
    const t = (btn.textContent || btn.value || "").replace(/\s+/g, " ").trim();
    if (!t) return;
    if (!/tarefa|adicion|salvar|planejar|feito|triagem/i.test(t)) return;
    out.buttons.push({
      i,
      tag: btn.tagName,
      text: t.slice(0, 120),
      className: btn.className || null,
      id: btn.id || null,
    });
  });

  try {
    if (window.tinymce?.get) {
      (window.tinymce.get() || []).forEach((ed) => {
        out.tinymce.push({
          id: ed.id,
          contentPreview: String(ed.getContent?.() || "").slice(0, 300),
        });
      });
    }
  } catch (e) {
    out.tinymceError = String(e);
  }

  const bodyText = document.body?.innerText || "";
  for (const hit of [
    "Adicionar uma nova tarefa",
    "Realizar triagem",
    "Feito",
    "witorio.couto",
    "TRIAGEM",
    "Planejar esta tarefa",
  ]) {
    out.visibleTextHits.push({ hit, found: bodyText.includes(hit) });
  }

  // Campos GLPI típicos — atalho
  out.quick = {
    state: document.querySelector("select[name='state']")?.value ?? null,
    users_id_tech: document.querySelector("select[name='users_id_tech']")?.value ?? null,
    groups_id_tech: document.querySelector("select[name='groups_id_tech']")?.value ?? null,
    tasktemplates_id: document.querySelector("select[name='tasktemplates_id']")?.value ?? null,
    contentName: document.querySelector("textarea[name='content']")?.name ?? null,
  };

  const json = JSON.stringify(out, null, 2);
  console.clear();
  console.log("%cLEITURA DA TAREFA GLPI", "color:#e10600;font-size:16px;font-weight:bold");
  console.log(json);

  try {
    await navigator.clipboard.writeText(json);
    console.log("%cJSON copiado para a área de transferência.", "color:#2db49e;font-weight:bold");
  } catch {
    console.log("%cNão consegui copiar automaticamente — selecione o JSON acima e copie.", "color:#f0b4aa");
  }

  return out;
})();
