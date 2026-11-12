---
name: clonar-site
description: Faz engenharia reversa de um website e o reconstrói como código editável o mais idêntico possível ao original, com captura determinística, construtores de seção em paralelo e portões medidos de fidelidade visual e de interação. Usar quando o usuário disser "/clonar-site", "clonar site", "clonar este site", "engenharia reversa do site", "replicar essa página", "recriar idêntico", "pixel-perfect", "copiar o layout de <url>", "rebuild this page" ou "clone website".
argument-hint: <url> [mais urls] [--stack next|vite|html] [--larguras 1440,768,390]
---

# Clonar site (engenharia reversa com fidelidade medida)

Reconstruir as páginas pedidas como código limpo e editável que renderiza igual ao original. Screenshots, iframes e bundles baixados do site são **evidência**, nunca a implementação. "Idêntico" é um resultado de portões medidos, não uma impressão: nunca declarar "pixel-perfect" sem o relatório verde.

Princípio do plugin: **mãos e olhos determinísticos, autoria pelo agente.** Os scripts em `scripts/` (relativos ao diretório base desta skill) capturam, comparam e reproduzem interações sem chamar modelo. O agente lê a evidência, escreve o código e repara o pior trecho medido.

## 0. Preparar (uma vez por máquina)

Definir `S=<diretório base desta skill>/scripts`. Se `$S/node_modules` não existir:

```bash
npm install --prefix "$S" && npx --prefix "$S" playwright install chromium
```

Confirmar que os MCPs do plugin respondem (Playwright MCP para agir no navegador, Chrome DevTools MCP para medir estilos, rede e fontes). Sem eles, seguir só com os scripts e `browser_evaluate` equivalente; não parar.

## 1. Escopo e limites

- Extrair as URLs do pedido. Sem URL, perguntar.
- Uso legítimo: o próprio site do usuário, migração de stack, estudo, protótipo interno ou site com autorização. Não reproduzir de forma funcional formulários de login ou pagamento de terceiros, não manter marca, logotipo e textos de outra empresa num clone que vá ao ar como se fosse ela. Se o pedido for claramente para se passar por outra organização, recusar essa parte e oferecer o clone com marca neutra.
- Deploy nunca é implícito. Entregar build local e URL de preview.
- Stack: seguir o projeto existente (ler `package.json`, rotas, convenções). Sem projeto, usar `--stack` ou o padrão **Next.js (App Router) + TypeScript + Tailwind v4**. `html` gera HTML/CSS puro (fidelidade máxima, menos editável); `vite` gera React + Vite.
- Criar a pasta de trabalho `.clone/<host>/` e o ledger `.clone/<host>/run.json` com: urls, stack, larguras, fase atual, seções, tentativas de reparo e melhores notas. Retomar um run existente da mesma URL em vez de recomeçar.

## 2. Capturar evidência confiável (portão 1: integridade)

```bash
node "$S/capture.mjs" <url> --out .clone/<host>/source --widths 1440,768,390
```

- Exigir `ok: true`. `ok: false` (bloqueio anti-bot, página vazia, erro HTTP) para o run: relatar e pedir ao usuário uma alternativa (outra URL, sessão logada via navegador do usuário, HTML salvo). **Nunca gerar a partir de conteúdo adivinhado.**
- Ler `capture-summary.json` e tratar cada `warning` (WebGL, canvas, iframes, Framer, scroll-driven) como teto de fidelidade declarado desde o início.
- Abrir os screenshots `screenshots/<largura>/full.png` e olhar a página inteira em cada largura. Um dump de DOM não substitui olhar.
- Varrer larguras intermediárias com o Playwright MCP perto de cada breakpoint de `tokens.json → breakpoints` e acima da largura de design (max-width só aparece em telas largas).
- Exercitar menus, abas, acordeões, carrosséis, hovers e links principais. Distinguir gatilho por **scroll, clique, hover ou tempo**. Usar entrada real (wheel, teclado, ponteiro).
- Para cada elemento importante, medir valores declarados (computed style, variáveis CSS, opções de bibliotecas) em vez de inferir de uma renderização.

Detalhes do que observar e como medir: [references/captura.md](references/captura.md). Se `libs.json` indicar Framer, GSAP, Lenis, Locomotive, Lottie ou animações de entrada: ler [references/animacoes-e-motion.md](references/animacoes-e-motion.md).

Fim da fase: cada seção e cada estado relevante tem evidência suficiente para construir, e o que não deu para obter está listado.

## 3. Planejar (brief, specs e contratos)

Escrever em `.clone/<host>/`:

1. `brief.md` — mapa rota original → rota local; ordem das seções (use os ids de `sections-<largura>.json`); fontes reais e arquivos; largura de container, gutters, grid; paleta e escala tipográfica de `tokens.json`; mapa URL do asset → caminho local; comportamentos globais (smooth scroll, header fixo, transições de página).
2. `sections/<id>.md` — uma spec por seção, autossuficiente para um construtor: screenshots por largura, medidas e computed styles relevantes, textos reais, assets, estados e o **arquivo de destino que ele possui**.
3. `contracts.json` — contratos de interação no formato de `scripts/interactions.mjs` (cabeçalho do arquivo). Partir de `interaction-candidates.json`, confirmar no navegador e incluir `refSelector` para provar o comportamento também no original.

## 4. Construir

Ordem obrigatória:

1. **Fundação (o orquestrador faz, sem delegar):** fontes reais (`@font-face` com os arquivos capturados; nunca trocar por "parecida"), tokens no tema (Tailwind `@theme` ou variáveis CSS), estilos globais, layout raiz, assets copiados de `source/assets` para `public/clone/<host>/` com nomes estáveis, e componentes compartilhados (header, footer, botões, cards) com **todos** os estados observados.
2. **Seções em paralelo:** despachar um agente `construtor-de-secao` por seção (ou grupo pequeno de seções), na mesma mensagem, cada um dono exclusivo dos seus arquivos. Entregar a spec, as larguras, a URL de preview e a linha de chegada. Arquivos compartilhados continuam com o orquestrador.
3. Integrar, rodar o build/check do projeto e subir o preview (`npm run dev` ou equivalente) em segundo plano.

Regras de construção em [references/construcao.md](references/construcao.md). As essenciais: texto e assets reais; cada seção raiz com `data-clone-section="<id da captura>"`; cada controle de contrato com `data-clone-interaction="<id>"`; nada de classes, markup ou bundles do framework de origem; nada de hotlink para o domínio original; controles visíveis precisam fazer o que prometem.

## 5. Verificar em ordem de portões

Rodar contra o preview, nas mesmas larguras da captura:

```bash
node "$S/compare.mjs" --ref <url> --cand <preview> --out .clone/<host>/qa/<n> --widths 1440,768,390
node "$S/interactions.mjs" --cand <preview> --ref <url> --contracts .clone/<host>/contracts.json --out .clone/<host>/qa/<n>/interacoes
```

Portões, nesta ordem (um portão vermelho a montante não é compensado por nota boa a jusante):

| # | Portão | Verde quando |
|---|---|---|
| 1 | Integridade da captura | `capture.mjs ok:true` |
| 2 | Estrutura | nenhuma seção `missing in clone` em nenhuma largura |
| 3 | Interações | todo contrato `green` (ou `not-in-source`) |
| 4 | Runtime | sem page errors, requests falhos, hotlinks, overflow horizontal ou imagens quebradas |
| 5 | Visual por seção | cada seção ≤ 2% de pixels divergentes e altura dentro de 1% |
| 6 | Build de produção | build do projeto passa |

Para a revisão, despachar o agente `revisor-de-fidelidade` (independente, não viu a construção): ele roda os scripts, abre as montagens e devolve tickets de reparo com valores medidos no original e no clone. Detalhes e limiares em [references/portoes-e-reparo.md](references/portoes-e-reparo.md).

## 6. Reparar automaticamente

Enquanto houver portão vermelho e orçamento:

1. Pegar o primeiro portão vermelho; dentro dele, a pior seção/estado medido.
2. Corrigir na ordem: geometria e seções faltando → tipografia e quebra de linha → recorte de assets → espaçamento → cor → movimento.
3. Erro global (fonte, token, container) corrige-se no token, não seção por seção.
4. Rebuild e rodar de novo todos os portões afetados. Registrar tentativa, delta e evidência no `run.json`.

Limites: no máximo 5 tentativas por seção × largura; parar após duas tentativas seguidas sem melhora. Guardar sempre a melhor versão medida (`.clone/<host>/best/`) e nunca terminar com regressão.

## 7. Entregar com honestidade

Estado final é um destes dois:

- **`pronto-para-revisao`**: todos os portões verdes, com o relatório como prova.
- **`falhou-com-residuos`**: listar cada resíduo com portão, seção/largura, valor esperado, valor medido, evidência, tentativas e motivo de parada.

Responder com: como rodar o preview, mapa de rotas, tabela de portões por largura, 2–3 montagens representativas (desktop e mobile), resíduos e tetos declarados (WebGL, vídeo em streaming, embeds). Dizer "pronto para sua revisão", nunca "aceito" ou "pixel-perfect" sem prova. A palavra final é do usuário.
