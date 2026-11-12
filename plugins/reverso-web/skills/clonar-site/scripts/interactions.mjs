#!/usr/bin/env node
// Replay interaction contracts on the clone (and optionally the source) and prove they work.
// Usage: node interactions.mjs --cand <url> --contracts <file.json> --out <dir> [--ref <url>] [--height 900]
// Contract file: JSON array of
//   { "id": "menu-mobile", "width": 390, "trigger": "click" | "hover" | "focus" | "scroll",
//     "selector": "<clone css selector>", "target": "<clone region to observe, optional>",
//     "refSelector": "<source selector, optional>", "refTarget": "<source region, optional>",
//     "steps": 1, "expect": "change" | "toggle", "scrollBy": 600 }
// A control "works" when the observed region changes by more than 0.5% of its pixels.
// "toggle" also requires a second activation to return close to the initial state.
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs, ensureDir, writeJSON, emit, launch, newContext, settle, readPNG, diffPNG, writePNG, montage } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.cand || !args.contracts) { emit({ ok: false, error: 'usage: interactions.mjs --cand <url> --contracts <file> --out <dir> [--ref <url>]' }); process.exit(2); }
const out = ensureDir(path.resolve(args.out || '.clone/interactions'));
const height = parseInt(args.height || '900', 10);
const contracts = JSON.parse(fs.readFileSync(args.contracts, 'utf8'));
const CHANGED = 0.005;

async function shotRegion(page, target, file) {
  if (target) {
    const el = page.locator(target).first();
    if (await el.count()) {
      const box = await el.boundingBox();
      if (box && box.width > 0 && box.height > 0) { await el.screenshot({ path: file }).catch(() => page.screenshot({ path: file })); return; }
    }
  }
  await page.screenshot({ path: file });
}

async function act(page, c, selector) {
  if (c.trigger === 'scroll') { await page.mouse.wheel(0, c.scrollBy || 600); return; }
  const el = page.locator(selector).first();
  if (!(await el.count())) throw new Error(`selector not found: ${selector}`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  if (c.trigger === 'hover') await el.hover();
  else if (c.trigger === 'focus') await el.focus();
  else await el.click();
}

async function run(browser, url, c, side) {
  const selector = side === 'ref' ? c.refSelector : c.selector;
  const target = side === 'ref' ? (c.refTarget || c.refSelector) : (c.target || c.selector);
  if (!selector && c.trigger !== 'scroll') return { skipped: true };
  const ctx = await newContext(browser, c.width || 1440, height);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dir = ensureDir(path.join(out, c.id));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(page, { freeze: false });
    if (c.trigger !== 'scroll' && selector) await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    const before = path.join(dir, `${side}-0.png`);
    await shotRegion(page, target, before);
    const results = [];
    const steps = c.expect === 'toggle' ? 2 : (c.steps || 1);
    for (let i = 1; i <= steps; i++) {
      await act(page, c, selector);
      await page.waitForTimeout(c.wait || 700);
      if (c.trigger === 'hover' && i === 1) { /* keep pointer */ }
      const f = path.join(dir, `${side}-${i}.png`);
      await shotRegion(page, target, f);
      const d = diffPNG(readPNG(before), readPNG(f));
      results.push({ step: i, changeFromInitial: +d.ratio.toFixed(4), file: path.relative(out, f) });
      if (i === 1) writePNG(path.join(dir, `${side}-montage.png`), montage(readPNG(before), readPNG(f), d.diff));
    }
    let works = results[0].changeFromInitial > CHANGED;
    if (c.expect === 'toggle') works = works && results[1].changeFromInitial < Math.max(CHANGED * 2, results[0].changeFromInitial * 0.25);
    return { works, results, errors };
  } catch (e) {
    return { works: false, error: e.message, errors };
  } finally { await ctx.close(); }
}

const browser = await launch();
const results = [];
for (const c of contracts) {
  const clone = await run(browser, args.cand, c, 'cand');
  const source = args.ref ? await run(browser, args.ref, c, 'ref') : { skipped: true };
  let afterStateMismatch = null;
  if (!clone.error && !source.skipped && !source.error) {
    try {
      const a = readPNG(path.join(out, c.id, 'ref-1.png')), b = readPNG(path.join(out, c.id, 'cand-1.png'));
      afterStateMismatch = +diffPNG(a, b).ratio.toFixed(4);
    } catch {}
  }
  // A behavior the source itself does not show is not a contract: report it, do not fail on it.
  const status = clone.works ? 'green' : (!source.skipped && source.works === false && !source.error) ? 'not-in-source' : 'red';
  results.push({ id: c.id, width: c.width || 1440, trigger: c.trigger, expect: c.expect || 'change', status, clone, source, afterStateMismatch });
}
await browser.close();
const verdict = results.every((r) => r.status !== 'red') ? 'pass' : 'fail';
writeJSON(path.join(out, 'interactions-report.json'), { verdict, results });
emit({
  ok: true, verdict, report: path.join(out, 'interactions-report.json'),
  results: results.map((r) => ({ id: r.id, width: r.width, status: r.status, change: r.clone.results?.[0]?.changeFromInitial, error: r.clone.error, sourceWorks: r.source.skipped ? null : r.source.works, afterStateMismatch: r.afterStateMismatch })),
});
