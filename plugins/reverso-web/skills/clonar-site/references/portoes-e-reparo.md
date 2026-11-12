# Portões de fidelidade e ciclo de reparo

## Como a comparação funciona

`compare.mjs` abre original e clone com o mesmo Chromium, viewport, deviceScaleFactor 1, user agent e locale; rola com wheel real até o fim (dispara lazy-load e animações de revelação), volta ao topo, espera fontes e imagens, para vídeos no quadro 0 e congela animações/transições. Depois:

1. Screenshot de página inteira dos dois lados.
2. Detecta as seções (no clone, pelos `data-clone-section`) e pareia pelo id; sem id, pela ordem.
3. Compara **cada seção separadamente** com `pixelmatch` (threshold 0.1, ignora anti-aliasing). Diferença de altura vira área magenta: nunca é escondida.
4. Gera `report.json`, `report.md`, `diff.png` da página e montagens `original | clone | diferença` das seções fora do verde.
5. Audita o clone: page errors, console errors, requests falhos, hotlinks para o original, overflow horizontal, imagens quebradas.

Comparar por seção evita o erro clássico: uma seção 30px mais alta desloca tudo abaixo e faz a página inteira parecer errada.

## Limiares padrão

| Medida | Verde | Âmbar | Vermelho |
|---|---|---|---|
| Pixels divergentes por seção | ≤ 2% | ≤ 5% | > 5% |
| Altura da seção | Δ ≤ max(4px, 1%) | fora disso (com pixels verdes) | — |
| Altura da página | Δ ≤ max(8px, 1%) | fora disso | — |

Ajustáveis com `--pass`, `--warn` e `--threshold`. Endurecer (`--pass 0.005`) para páginas estáticas simples; afrouxar só com justificativa registrada (ex.: anti-aliasing de fonte variável).

Regiões legitimamente dinâmicas (banner de cookies, chat, contador, depoimentos aleatórios, "visto há X minutos") são mascaradas com `--mask ".seletor1,.seletor2"` e listadas na entrega. Mascarar para esconder erro é proibido.

## Diagnóstico por padrão de diferença

| O que a montagem mostra | Causa provável | Onde corrigir |
|---|---|---|
| Texto inteiro "dobrado" em vermelho, mesmas posições | Fonte, peso ou renderização diferente | Fundação: `@font-face`, pesos |
| Texto deslocado só verticalmente | line-height ou margem | Token tipográfico / spacing |
| Tudo abaixo de um ponto deslocado | Elemento com altura errada acima | O primeiro bloco onde começa o desvio |
| Quebras de linha diferentes | Fonte errada, letter-spacing ou largura de container | Fonte primeiro, depois container |
| Faixa magenta no fim | Seção mais curta/alta | Padding/gap/altura da seção |
| Imagem com borda vermelha | Recorte, `object-position` ou asset diferente | Asset e `object-fit` |
| Cor de fundo inteira vermelha | Token de cor ou gradiente | Tema |

Para confirmar, medir o mesmo seletor no original e no clone com o snippet de `captura.md` e comparar os valores.

## Ciclo de reparo

1. Primeiro portão vermelho → pior seção/largura dentro dele.
2. Ler a montagem, medir os elementos divergentes nos dois lados, achar o componente dono.
3. Uma correção baseada em evidência (ou no token, se o erro se repete em várias seções).
4. Rebuild, rodar de novo os portões afetados, registrar no `run.json`: tentativa, seção, largura, mismatch antes/depois, arquivo de evidência.
5. Melhorou → salvar cópia do arquivo em `.clone/<host>/best/`. Piorou → restaurar a melhor versão.

Orçamento: 5 tentativas por seção × largura; parar após duas tentativas seguidas sem melhora.

## Tetos conhecidos (declarar, não esconder)

- WebGL/canvas e shaders: conteúdo e layout clonam; o desenho em tempo de execução pode não clonar.
- Vídeo em streaming (`blob:`/HLS): usar poster ou embed.
- Conteúdo personalizado por usuário, A/B testing e geolocalização: capturar uma variante e dizer qual.
- Fontes com licença restrita: precisa de licença do usuário.
