---
name: extrair-design-system
description: Extrai o design system real de um site (cores, tipografia, espaçamentos, raios, sombras, breakpoints, fontes e componentes) a partir dos estilos computados e gera tema pronto para Tailwind v4 ou variáveis CSS, sem clonar a página. Usar quando o usuário pedir "extrair design system", "pegar as cores e fontes de <url>", "tokens do site", "paleta desse site", "usar esse site como referência visual" ou "tema Tailwind igual ao de <url>".
argument-hint: <url> [--formato tailwind|css|json]
---

# Extrair design system

Usa a captura determinística da skill `clonar-site`. Definir `S=<diretório base desta skill>/../clonar-site/scripts` e preparar se faltar `$S/node_modules`:

```bash
npm install --prefix "$S" && npx --prefix "$S" playwright install chromium
```

## Passos

1. Capturar (três larguras revelam a tipografia responsiva):
   ```bash
   node "$S/capture.mjs" <url> --out .clone/<host>/source --widths 1440,768,390
   ```
   `ok:false` → relatar o bloqueio e parar.
2. Ler `tokens.json`, `fonts-loaded.json`, `libs.json` e os screenshots. Se o site expõe variáveis CSS em `:root` (`cssVariables`), elas são a fonte da verdade: usar os nomes e valores dele.
3. Consolidar (decisões do agente, sempre a partir das contagens):
   - **Cores**: agrupar tons quase iguais (diferença perceptível pequena), nomear por papel (fundo, superfície, texto, texto suave, marca, destaque, borda, estados). Registrar a frequência de uso.
   - **Tipografia**: famílias e pesos carregados; escala a partir de `typography` e `samples` (h1…h6, corpo, legenda, botão) com tamanho, line-height e letter-spacing por breakpoint.
   - **Espaçamento**: detectar a base (4px ou 8px) pelas frequências de `spacing`; listar os degraus usados.
   - **Raios, sombras, bordas, gradientes, max-widths, breakpoints**.
   - **Componentes**: botões, cards, inputs, badges, navegação — medir cada variante no navegador (Playwright MCP / Chrome DevTools MCP) com estados hover e focus.
4. Gerar, conforme o formato pedido (padrão: Tailwind v4):
   - `design-system.md`: tabelas com token, valor, papel, frequência e exemplo.
   - `theme.css`: bloco `@theme` do Tailwind v4 (ou `:root` com variáveis CSS).
   - `tokens.json` limpo (formato de design tokens).
   - Uma página HTML de amostra com paleta, escala tipográfica e componentes, para conferência visual lado a lado com o original.

## Cuidados

- Fontes comerciais: indicar a fonte e o provedor; o arquivo só pode ser usado com licença.
- O design system descreve o site; aplicar marca, logotipo e textos de outra empresa num produto próprio pode infringir direitos. Para inspiração, sugerir adaptar a paleta e a tipografia em vez de copiar a identidade inteira.
