# Triar Auto — Processos & Despacho

Extensão Chrome (Manifest V3) que clica automaticamente, no intervalo configurado (padrão: 5 minutos), em:

- **TRIAR PROCESSOS** (botão da tela de triagem)
- **Criar Despacho** (botão `.t-Button-label`)

Escolha o alvo no popup. Depois de reload/navegação, a extensão **reinjeta o script**, espera o alvo voltar (até 60s) e segue o ciclo.

**Desenvolvido por Witório Bandeira**

## Como instalar

1. Abra o Chrome em `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `extension` deste repositório

## Como usar

1. Abra a página do sistema onde o botão **TRIAR PROCESSOS** aparece
2. Clique no ícone da extensão
3. Confirme que o status mostra o botão encontrado
4. Ajuste o intervalo (1–60 minutos) se quiser
5. Clique em **Iniciar**

A extensão também oferece **Clicar agora** para um disparo manual imediato.

## O que ela procura

O content script tenta, nesta ordem:

1. `[data-otel-label="TRIAR_NIVEL_12"]`
2. `#B68314861501381838`
3. Botões `.t-Button` / `button` cujo texto contenha `TRIAR PROCESSOS`

## Arquivos

```
extension/
├── manifest.json
├── background/service-worker.js
├── content/content.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── icons/
```
