# Triar Auto — Processos & Despacho (v1.4.0)

Extensão Chrome multi-aba para clicar automaticamente em:

- **TRIAR PROCESSOS**
- **Criar Despacho**

**Desenvolvido por Witório Bandeira**

## Anti-pausa (v1.4)

- A automação **só para** se você clicar em Pausar / Pausar todas
- Falha de clique **não** desliga o job
- Watchdog a cada 1 min recria o alarme se o Chrome dropar
- Se a aba fechar/recarregar pesado, a intenção fica salva e **reconecta** sozinha
- Storage com fila (sem race apagando `enabled`)
- Clique rápido nos frames (não trava 90s × N frames)

## Uso com 2 abas

1. Aba triagem → TRIAR PROCESSOS → **Iniciar nesta aba**
2. Aba despacho → Criar Despacho → **Iniciar nesta aba**

No popup, veja **Status global** e **Últimos eventos**.

## Instalar

1. Extraia o zip  
2. `chrome://extensions` → remova a versão antiga  
3. **Carregar sem compactação**
