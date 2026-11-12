---
name: comparar-com-original
description: Mede o quanto uma página construída (local, staging ou produção) é fiel a uma página de referência, seção por seção e por breakpoint, e testa se as interações funcionam, com relatório e imagens de diferença. Usar quando o usuário pedir "comparar com o original", "ficou igual?", "medir fidelidade", "diff visual", "regressão visual", "o clone está idêntico?", "revisar o clone" ou quiser checar um redesign contra uma referência.
argument-hint: <url de referência> <url a comparar> [--larguras 1440,768,390]
---

# Comparar com o original

Usa os scripts determinísticos da skill `clonar-site`. Definir `S=<diretório base desta skill>/../clonar-site/scripts` e preparar se faltar `$S/node_modules`:

```bash
npm install --prefix "$S" && npx --prefix "$S" playwright install chromium
```

## Passos

1. Confirmar as duas URLs e as larguras (padrão 1440, 768, 390). Se a página a comparar for local, garantir que o servidor está rodando.
2. Rodar a comparação visual:
   ```bash
   node "$S/compare.mjs" --ref <referência> --cand <comparada> --out .clone/compare/<data-hora> --widths 1440,768,390
   ```
   Seções são pareadas por `data-clone-section`; se a página comparada não tiver essa marcação, o pareamento é pela ordem das seções detectadas (avisar que fica menos preciso).
3. Se houver `contracts.json` (ou o usuário citar interações), rodar:
   ```bash
   node "$S/interactions.mjs" --cand <comparada> --ref <referência> --contracts <arquivo> --out .clone/compare/<data-hora>/interacoes
   ```
   Sem arquivo, montar contratos a partir dos controles visíveis (menu, abas, acordeões, carrossel) antes de rodar.
4. Abrir `report.md` e as montagens das 3 piores seções. Para cada uma, medir os elementos divergentes nos dois lados (snippet em `../clonar-site/references/captura.md`) e apontar a causa provável com a tabela de diagnóstico de `../clonar-site/references/portoes-e-reparo.md`.

## Resposta

- Veredito (`pass`, `near`, `fail`) e tabela de portões por largura.
- Piores seções com mismatch, Δ de altura e causa medida (valor no original vs. no clone).
- Problemas de runtime (erros, assets quebrados, hotlinks, overflow).
- Correções sugeridas em ordem de impacto. Não editar código, a menos que o usuário peça.
- Enviar as montagens mais úteis como arquivo para o usuário ver.
