# Animações, motion e sites Framer

## Identificar o motor

Ver `libs.json` e confirmar no navegador:

| Sinal | Motor | Como reproduzir |
|---|---|---|
| `data-framer-*`, `framerusercontent.com` | Framer (usa Framer Motion) | `motion` (ex-Framer Motion) com os mesmos `initial/animate/transition` |
| `window.gsap`, `ScrollTrigger` | GSAP | GSAP + ScrollTrigger com as mesmas opções (`start`, `end`, `scrub`, `pin`) |
| `html.lenis`, `window.lenis` | Lenis (smooth scroll) | `lenis` com as mesmas opções (`lerp`, `duration`, `easing`) |
| `has-scroll-smooth` | Locomotive Scroll | Lenis com parâmetros equivalentes ou Locomotive |
| `[data-aos]` | AOS | Reproduzir com IntersectionObserver + CSS ou `motion` |
| `.swiper`, `.embla`, `.splide` | Carrossel | A mesma biblioteca e as mesmas opções (loop, slidesPerView por breakpoint, autoplay) |
| `lottie-player`, `.json` de animação | Lottie | Baixar o JSON e usar `lottie-web`/`@lottiefiles/dotlottie-react` |
| Só `transition`/`@keyframes` | CSS | CSS puro com mesma duração e `cubic-bezier` |

## Ler as opções, não adivinhar

- GSAP: no console, `ScrollTrigger.getAll().map(t => t.vars)` e `gsap.globalTimeline.getChildren()` revelam `start/end/scrub/pin` e durações.
- Lenis: `window.lenis.options` quando exposto.
- Swiper: `document.querySelector('.swiper').swiper.params`.
- CSS: computed `transition`, `animation-name`, `animation-duration`, `animation-timing-function` e a regra `@keyframes` no CSS capturado.
- Framer: os valores de `transform`/`opacity` antes e depois da entrada; o easing costuma estar no estilo inline durante a animação. Medir em três momentos: inicial, no meio, assentado.

## Sites Framer

- O markup é profundamente aninhado com classes geradas: não copiar. Reconstruir semanticamente a partir das medidas.
- Componentes "stack" do Framer são flexbox com `gap`; "frames" fixos usam posição absoluta. Medir qual é qual.
- Breakpoints do Framer costumam ser 1200/810/390: confirmar em `tokens.json → breakpoints`.
- Entradas típicas: opacity 0→1 com translateY 20–40px, spring. Reproduzir com `motion` e `whileInView` com `viewport={{ once: true }}`.

## Verificar movimento

- Animação de entrada: comparar estados inicial, ativo e assentado (o `compare.mjs` compara o assentado e congelado).
- Scroll-driven: criar contrato `"trigger": "scroll"` com `scrollBy` em `contracts.json` e comparar o estado depois da rolagem nos dois lados; testar também rolagem reversa.
- Hover: contrato `"trigger": "hover"`.
- Sempre usar wheel real: scroll programático ignora Lenis e listeners de wheel.
- Respeitar `prefers-reduced-motion` se o original respeita.
