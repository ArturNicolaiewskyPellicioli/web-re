# reverso-web

Plugin para Claude Code que faz engenharia reversa de websites e reconstrói as páginas como código editável o mais idêntico possível ao original, **com a fidelidade medida**, não estimada.

- Captura determinística: screenshots por breakpoint, seções, tokens de design, fontes, imagens, vídeos e SVGs reais.
- Construtores de seção em paralelo, cada um dono dos seus arquivos.
- Comparação pixel a pixel **por seção** e por breakpoint, com montagens original | clone | diferença.
- Replay de interações (menu, abas, acordeão, carrossel, hover, scroll) no original e no clone.
- Ciclo de reparo automático e entrega honesta: `pronto-para-revisao` ou `falhou-com-residuos`.

## Instalação

No Claude Code:

```
/plugin marketplace add ArturNicolaiewskyPellicioli/web-re
/plugin install reverso-web@reverso-web
```

Requisitos: Node 20+. Na primeira execução, as skills instalam as dependências dos scripts e o Chromium do Playwright.

## Uso

```
/clonar-site https://exemplo.com
/comparar-com-original https://exemplo.com http://localhost:3000
/extrair-design-system https://exemplo.com
```

Documentação completa do plugin: [plugins/reverso-web/README.md](plugins/reverso-web/README.md).

## Estrutura

```
.claude-plugin/marketplace.json     # este repositório é um marketplace
plugins/reverso-web/                # o plugin
  .claude-plugin/plugin.json
  .mcp.json                         # Playwright MCP + Chrome DevTools MCP
  agents/                           # construtor-de-secao, revisor-de-fidelidade
  skills/clonar-site/               # orquestrador + scripts determinísticos + referências
  skills/comparar-com-original/
  skills/extrair-design-system/
```

## Uso responsável

Feito para o seu próprio site, migração de stack, estudo, protótipos internos ou sites com autorização. Não publique clones que se passem por outra empresa nem reproduza de forma funcional login ou pagamento de terceiros.

## Licença

MIT
