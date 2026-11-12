# Captura e inspeção

Objetivo: evidência que muda o que vai ser construído — layout, conteúdo, assets e estados. Um brief bem feito vale mais que um dump enorme.

## O que `capture.mjs` já entrega

| Arquivo | Conteúdo | Uso |
|---|---|---|
| `screenshots/<w>/full.png`, `viewport.png`, `<secao>.png` | Página inteira, primeira dobra e cada seção, após carregar lazy media, revelar seções de scroll e congelar animações | Referência visual de cada spec |
| `sections-<w>.json` | Seções raiz com id, seletor, rótulo, retângulo absoluto, posição e fundo | Ids das seções; o clone usa os mesmos ids em `data-clone-section` |
| `tokens.json` | Cores de texto/fundo/borda, gradientes, combinações tipográficas com contagem, amostras por tag, raios, sombras, espaçamentos, max-widths, variáveis CSS de `:root`, media queries e breakpoints, `@font-face` | Fonte para o tema e para a escala tipográfica |
| `fonts-loaded.json` | Famílias/pesos realmente carregados | Garante a fonte certa |
| `dom.json` | Imagens (`currentSrc`, `srcset`, `object-fit`, posição), backgrounds, vídeos (autoplay/loop/muted/poster), SVGs inline salvos, iframes, links, `head` (title, meta, OG, ícones) | Mapa de assets e metadados |
| `assets/` + `assets.json` | Corpo de cada imagem, fonte, CSS e vídeo que o navegador carregou, com URL de origem, content-type real e bytes | Assets locais; nunca hotlink |
| `libs.json` | Framework e bibliotecas (Next, Framer, Webflow, GSAP, Lenis, Swiper, Lottie, WebGL…) | Decide como reproduzir comportamento |
| `interaction-candidates.json` | Controles com `aria-expanded`, `details`, abas, popups, carrosséis, diálogos, botões de navegação | Ponto de partida para `contracts.json` |
| `page.html` | DOM renderizado | Textos reais e estrutura semântica |

## Estrutura visual

- Registrar ordem das seções, max-width, gutters, proporção de colunas e camadas fixas/sticky.
- Medir família, peso, tamanho, line-height e letter-spacing de títulos e corpo. **Acertar a fonte antes de mexer em larguras para corrigir quebra de linha.**
- Varrer a largura do mobile até além do desktop, estreitando perto de cada transição. Registrar empilhamento, troca de menu, reflow de texto e troca de recorte/asset. Screenshot de desktop reduzido não é referência mobile.

## Medição com o navegador (Playwright MCP / Chrome DevTools MCP)

Para um seletor observado, medir com avaliação de DOM: `textContent`, `getBoundingClientRect()` e computed `font`, `letterSpacing`, `color`, `background`, `gap`, `padding`, `borderRadius`, `position`, `transform`, `transition`. Medir antes e depois de cada estado (hover, aberto, ativo).

Snippet útil para um bloco inteiro (rodar no original e no clone e comparar):

```js
(sel) => [...document.querySelectorAll(`${sel}, ${sel} *`)].slice(0, 80).map(e => {
  const c = getComputedStyle(e), r = e.getBoundingClientRect();
  return { tag: e.tagName, text: e.textContent.trim().slice(0, 30), x: r.x|0, y: r.y|0, w: r.width|0, h: r.height|0,
    font: `${c.fontWeight} ${c.fontSize}/${c.lineHeight} ${c.fontFamily.split(',')[0]}`, ls: c.letterSpacing,
    color: c.color, bg: c.backgroundColor, pad: c.padding, gap: c.gap, radius: c.borderRadius, shadow: c.boxShadow };
})
```

Chrome DevTools MCP é o melhor para rede (qual arquivo de fonte carregou), cobertura de CSS e performance; Playwright MCP é o melhor para agir (clicar, rolar, redimensionar) e tirar screenshots.

## Assets

- Imagens: `currentSrc` (não só `src`), `srcset`, dimensões, `object-fit`, `object-position`, alt.
- Camadas: imagens, backgrounds e SVGs sobrepostos e como estão posicionados.
- Vídeo: fonte, poster, autoplay/loop/mute, proporção, controles. Vídeo `blob:` (streaming) não baixa: registrar como resíduo e usar poster ou embed.
- Fontes: família e pesos realmente carregados e os arquivos usados. Substituta de outro provedor tem métricas diferentes.
- SVG: `viewBox` e gradientes, máscaras, símbolos e filtros referenciados.
- Conferir content-type e dimensões: uma URL `.png` pode devolver AVIF; HTTP 200 pode ser página de erro.

## Estados

Registrar gatilho → resultado visível. Rolar antes de clicar para não confundir cena fixada (pinned) com abas. Scripts globais (smooth scroll, snapping, cursor custom, transição de página) mudam toda interação: identificar pela classe no `<html>`, globais e scripts carregados, e registrar as opções.

## Bloqueios

Se o site bloquear headless (Cloudflare, captcha), não contornar à força. Opções para propor ao usuário: rodar a captura pelo navegador dele já logado (Claude in Chrome), salvar a página completa (HTML + assets) e apontar o clone para os arquivos, ou usar a URL de staging.
