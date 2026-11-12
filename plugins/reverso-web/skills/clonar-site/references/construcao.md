# Regras de construção

## Fundação antes das seções

1. **Fontes**: `@font-face` com os arquivos capturados em `public/clone/<host>/fonts/` (ou `next/font/local`), mesmos pesos, `font-display` e `unicode-range` do original. Se a fonte for de serviço com licença (Adobe Fonts, fontes pagas), avisar o usuário e usar o arquivo só se ele tiver licença; caso contrário, declarar resíduo.
2. **Tokens**: transformar `tokens.json` em tema. Tailwind v4: bloco `@theme` com `--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--breakpoint-*` iguais aos breakpoints do original. Sem Tailwind: variáveis CSS em `:root`. Reaproveitar as variáveis CSS do original quando existirem (mesmos nomes facilitam o diff).
3. **Container e grid**: max-width, gutters e colunas exatos do original.
4. **Componentes compartilhados** com todos os estados (hover, focus, ativo, aberto, breakpoints), prontos para os construtores reaproveitarem.

## Fidelidade

- Valores exatos medidos, não aproximações da escala padrão. Tailwind: valores arbitrários (`px-[18px]`, `text-[#0f766e]`, `leading-[1.15]`, `tracking-[-0.02em]`) quando o token não existe. Isso é o que permite casar cor e espaçamento ao pixel.
- Mesma unidade do original quando ela importa para responsividade (`clamp()`, `vw`, `%`, `rem`).
- Imagens com o mesmo recorte: `object-fit`, `object-position`, proporção e `srcset`/`sizes` quando o original troca de asset por largura. Next.js: `next/image` com `sizes` correto ou `<img>` simples se o otimizador alterar o recorte.
- Texto real, inclusive quebras forçadas, maiúsculas via CSS (`text-transform`) e não digitadas.
- Sombras, bordas, gradientes e blur copiados do computed style.
- Sticky/fixed: não colocar `overflow:hidden` em ancestrais de elementos sticky.

## Marcação obrigatória

- Cada seção raiz: `data-clone-section="<id de sections-<w>.json>"`. Todas as seções devem ser marcadas (se uma for marcada, a comparação usa só as marcadas).
- Cada controle de contrato: `data-clone-interaction="<id>"`; região controlada: `data-clone-controlled="<id>"`.
- Header e footer contam como seção.

## Proibido

- Copiar markup, classes geradas (`framer-xyz`, `css-1a2b3c`, `sc-…`) ou bundles JS do original.
- Hotlink para o domínio original (o portão de runtime reprova).
- Imagem/screenshot no lugar de conteúdo real (texto, botões, cards).
- Controle visível que não funciona (carrossel parado, menu que não abre).
- Iframe do site original.

## Organização de arquivos (padrão Next.js)

```
src/app/(clone)/<rota>/page.tsx          # monta as seções em ordem
src/components/clone/<host>/<secao>.tsx  # um arquivo por seção (dono: um construtor)
src/components/clone/<host>/shared/       # dono: orquestrador
public/clone/<host>/{images,fonts,media,svg}/
```

Componentes pequenos, sem duplicar funções entre seções: o que se repete vira componente compartilhado (pedido ao orquestrador, não recriado por cada construtor).

## Links

Links entre páginas clonadas viram rotas locais. Links fora do escopo continuam apontando para o destino real e são listados na entrega.
