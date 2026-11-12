# reverso-web

Plugin de engenharia reversa de websites para Claude Code: transforma uma URL em código editável que renderiza igual ao original e **prova** isso com medidas.

## Por que funciona

Ele junta o que cada projeto de referência da comunidade faz de melhor:

| Ideia | De onde veio | Como entra aqui |
|---|---|---|
| Specs por seção + construtores em paralelo | `JCodesMore/ai-website-cloner-template` (skill clone-website) | Orquestrador faz a fundação; um `construtor-de-secao` por seção, dono exclusivo dos seus arquivos |
| Mãos e olhos determinísticos, portões em ordem, estados finais honestos | `ericshang98/perfect-web-clone` | `capture.mjs`, `compare.mjs`, `interactions.mjs` não chamam modelo; terminal é `pronto-para-revisao` ou `falhou-com-residuos` |
| Revisor de QA obsessivo e separado de quem constrói | `horuz-ai/claude-plugins` (website-cloner) | Agente `revisor-de-fidelidade`, que mede e não edita |
| Agir vs. observar no navegador | Playwright MCP (Microsoft) + Chrome DevTools MCP (Google) | Os dois já configurados no `.mcp.json` |

O que é próprio deste plugin: comparação **por seção** (uma seção mais alta não contamina o resto da página), diferença de altura contada como erro (nunca escondida), replay de interações provando o comportamento no original e no clone, e auditoria de runtime (hotlinks, overflow, imagens quebradas).

## Skills

- `/clonar-site <url>` — fluxo completo: captura → plano → fundação → seções em paralelo → portões → reparo → entrega.
- `/comparar-com-original <ref> <url>` — mede a fidelidade de qualquer página contra uma referência (serve também para regressão visual).
- `/extrair-design-system <url>` — tokens, tipografia, cores, espaçamento e tema Tailwind v4, sem clonar.

## Agentes

- `construtor-de-secao` — constrói e itera uma seção até ficar verde.
- `revisor-de-fidelidade` — QA independente com tickets medidos (esperado × encontrado).

## Requisitos

- Claude Code, Node 20+.
- Na primeira execução as skills instalam as dependências dos scripts (`playwright`, `pixelmatch`, `pngjs`) e o Chromium.
- MCPs incluídos: `@playwright/mcp` e `chrome-devtools-mcp` (via `npx`, sem chave de API).

## Scripts (uso direto)

```bash
S=skills/clonar-site/scripts
npm install --prefix $S && npx --prefix $S playwright install chromium

node $S/capture.mjs https://exemplo.com --out .clone/exemplo/source --widths 1440,768,390
node $S/compare.mjs --ref https://exemplo.com --cand http://localhost:3000 --out .clone/exemplo/qa/1
node $S/interactions.mjs --cand http://localhost:3000 --ref https://exemplo.com --contracts .clone/exemplo/contracts.json --out .clone/exemplo/qa/1/interacoes
```

Todos imprimem JSON. `ok:false` em `capture.mjs` significa captura não confiável (bloqueio, página vazia, erro) e o fluxo para.

## Limiares padrão

Seção verde com ≤ 2% de pixels divergentes (pixelmatch, threshold 0.1, sem anti-aliasing) e altura dentro de max(4px, 1%). Âmbar até 5%. Ajustável com `--pass`, `--warn`, `--threshold`.

## Limites honestos

WebGL/canvas, vídeo em streaming, conteúdo personalizado e fontes com licença restrita têm teto de fidelidade e são declarados como resíduo. O plugin não faz deploy sozinho.

## Uso responsável

Feito para o seu próprio site, migração de stack, estudo, protótipos internos ou sites com autorização. Não publique clones que se passem por outra empresa nem reproduza de forma funcional login ou pagamento de terceiros.
