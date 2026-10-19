# Triar Auto — Processos & Despacho

Extensão Chrome (Manifest V3) multi-aba para automatizar cliques em:

- **TRIAR PROCESSOS**
- **Criar Despacho** (`span.t-Button-label`)

**Desenvolvido por Witório Bandeira**

## Como usar com 2 abas

1. Aba 1 (triagem): escolha **TRIAR PROCESSOS** → **Iniciar nesta aba**
2. Aba 2 (despacho): escolha **Criar Despacho** → **Iniciar nesta aba**
3. As duas ficam ativas ao mesmo tempo (veja “Abas ativas” no popup)

Cada aba guarda a própria ação. O intervalo é global.

## Detecção

- Varre **todos os frames** da aba
- Procura por `data-otel-label`, id, `.t-Button-label` e texto normalizado
- Espera até 90s após reload da página
- Reinjeta o script automaticamente

## Instalar

1. Extraia o zip
2. `chrome://extensions` → Modo do desenvolvedor
3. Remova a versão antiga
4. **Carregar sem compactação** → pasta extraída
