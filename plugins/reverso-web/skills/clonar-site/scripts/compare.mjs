#!/usr/bin/env node
// Measured fidelity gate: original vs clone, section by section, per breakpoint.
// Usage: node compare.mjs --ref <url> --cand <url> --out <dir>
//   [--widths 1440,768,390] [--height 900] [--threshold 0.1] [--pass 0.02] [--warn 0.05]
//   [--mask ".cookie-banner,.chat-widget"] [--no-freeze]
// Sections are matched by data-clone-section id (clone) == source section id, then by order.
// Prints JSON; `verdict` is "pass" only when every gate is green.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, widthsFrom, ensureDir, writeJSON, emit, launch, newContext, settle, detectSectionsInPage,
  readPNG, writePNG, crop, diffPNG, montage,
} from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.ref || !args.cand) { emit({ ok: false, error: 'usage: compare.mjs --ref <url> --cand <url> --out <dir>' }); process.exit(2); }
const out = path.resolve(args.out || '.clone/compare');
const widths = widthsFrom(args.widths);
const height = parseInt(args.height || '900', 10);
const threshold = parseFloat(args.threshold || '0.1');
const PASS = parseFloat(args.pass || '0.02');
const WARN = parseFloat(args.warn || '0.05');
const masks = args.mask ? String(args.mask).split(',').map((s) => s.trim()).filter(Boolean) : [];
const freeze = !args['no-freeze'];
const refOrigin = new URL(args.ref).origin;
const candOrigin = new URL(args.cand).origin;
ensureDir(out);

const grade = (r) => (r <= PASS ? 'green' : r <= WARN ? 'amber' : 'red');

async function shoot(browser, url, width, file, audit) {
  const ctx = await newContext(browser, width, height);
  const page = await ctx.newPage();
  if (audit) {
    page.on('console', (m) => { if (m.type() === 'error') audit.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => audit.pageErrors.push(String(e.message).slice(0, 300)));
    page.on('requestfailed', (r) => audit.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
    page.on('response', (r) => {
      if (r.status() >= 400) audit.failedRequests.push({ url: r.url(), status: r.status() });
      const u = r.url();
      if (refOrigin !== candOrigin && u.startsWith(refOrigin)) audit.hotlinks.add(u);
    });
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page, { freeze, masks });
  await page.screenshot({ path: file, fullPage: true });
  const sections = await page.evaluate(detectSectionsInPage);
  const metrics = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0).map((i) => i.src).slice(0, 20),
  }));
  await ctx.close();
  return { sections, metrics };
}

function pairSections(ref, cand) {
  const byId = new Map(cand.map((s) => [s.id, s]));
  const used = new Set();
  const pairs = ref.map((r, i) => {
    let c = byId.get(r.id);
    if (!c && cand[i] && !used.has(cand[i].id) && !ref.some((x) => x.id === cand[i].id)) c = cand[i];
    if (c) used.add(c.id);
    return { ref: r, cand: c || null };
  });
  const extra = cand.filter((c) => !used.has(c.id));
  return { pairs, extra };
}

const browser = await launch();
const report = { ok: true, ref: args.ref, cand: args.cand, thresholds: { pixel: threshold, pass: PASS, warn: WARN }, widths: {}, worst: [], verdict: 'pass' };
try {
  for (const width of widths) {
    const dir = ensureDir(path.join(out, String(width)));
    const audit = { consoleErrors: [], pageErrors: [], failedRequests: [], hotlinks: new Set() };
    const R = await shoot(browser, args.ref, width, path.join(dir, 'ref.png'));
    const C = await shoot(browser, args.cand, width, path.join(dir, 'cand.png'), audit);
    const refPng = readPNG(path.join(dir, 'ref.png'));
    const candPng = readPNG(path.join(dir, 'cand.png'));
    const full = diffPNG(refPng, candPng, { threshold });
    writePNG(path.join(dir, 'diff.png'), full.diff);

    const { pairs, extra } = pairSections(R.sections, C.sections);
    const sections = [];
    for (const { ref, cand } of pairs) {
      if (!cand) { sections.push({ id: ref.id, label: ref.label, status: 'red', reason: 'missing in clone', refHeight: ref.rect.height }); continue; }
      const a = crop(refPng, 0, ref.rect.y, width, ref.rect.height);
      const b = crop(candPng, 0, cand.rect.y, width, cand.rect.height);
      const d = diffPNG(a, b, { threshold });
      const dh = cand.rect.height - ref.rect.height;
      const heightOk = Math.abs(dh) <= Math.max(4, ref.rect.height * 0.01);
      let status = grade(d.ratio);
      if (!heightOk && status === 'green') status = 'amber';
      const entry = {
        id: ref.id, cloneId: cand.id, label: ref.label, status, mismatch: +d.ratio.toFixed(4),
        refHeight: ref.rect.height, cloneHeight: cand.rect.height, heightDelta: dh, refY: ref.rect.y, cloneY: cand.rect.y,
      };
      if (status !== 'green') {
        entry.montage = path.join(String(width), `section-${ref.id}.png`);
        writePNG(path.join(out, entry.montage), montage(a, b, d.diff));
      }
      sections.push(entry);
    }
    const hd = C.metrics.height - R.metrics.height;
    const w = {
      pageHeight: { ref: R.metrics.height, clone: C.metrics.height, delta: hd, ok: Math.abs(hd) <= Math.max(8, R.metrics.height * 0.01) },
      fullPageMismatch: +full.ratio.toFixed(4),
      sections,
      extraCloneSections: extra.map((s) => ({ id: s.id, label: s.label, height: s.rect.height })),
      audit: {
        consoleErrors: audit.consoleErrors, pageErrors: audit.pageErrors,
        failedRequests: audit.failedRequests.slice(0, 30), hotlinkedFromSource: [...audit.hotlinks].slice(0, 30),
        horizontalOverflow: C.metrics.scrollWidth > width, brokenImages: C.metrics.brokenImages,
      },
      files: { ref: `${width}/ref.png`, clone: `${width}/cand.png`, diff: `${width}/diff.png` },
    };
    const auditRed = w.audit.pageErrors.length || w.audit.failedRequests.length || w.audit.hotlinkedFromSource.length || w.audit.horizontalOverflow || w.audit.brokenImages.length;
    w.gates = {
      structure: sections.every((s) => s.reason !== 'missing in clone') ? 'green' : 'red',
      visual: sections.some((s) => s.status === 'red') ? 'red' : sections.some((s) => s.status === 'amber') ? 'amber' : 'green',
      pageHeight: w.pageHeight.ok ? 'green' : 'amber',
      runtime: auditRed ? 'red' : w.audit.consoleErrors.length ? 'amber' : 'green',
    };
    report.widths[width] = w;
    for (const s of sections) if (s.status !== 'green') report.worst.push({ width, ...s });
  }
  report.worst.sort((a, b) => (b.mismatch ?? 1) - (a.mismatch ?? 1));
  const all = Object.values(report.widths).flatMap((w) => Object.values(w.gates));
  report.verdict = all.includes('red') ? 'fail' : all.includes('amber') ? 'near' : 'pass';
} catch (e) {
  report.ok = false; report.verdict = 'error'; report.error = e.stack || String(e);
} finally {
  await browser.close();
}
writeJSON(path.join(out, 'report.json'), report);

// Human-readable summary.
const lines = [`# Fidelity report`, '', `- Original: ${args.ref}`, `- Clone: ${args.cand}`, `- Verdict: **${report.verdict}** (pass ≤ ${PASS * 100}% mismatched pixels per section, warn ≤ ${WARN * 100}%)`, ''];
for (const [width, w] of Object.entries(report.widths)) {
  lines.push(`## ${width}px — gates: ${Object.entries(w.gates).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  lines.push(`Page height: original ${w.pageHeight.ref}px, clone ${w.pageHeight.clone}px (Δ ${w.pageHeight.delta}px). Full-page mismatch ${(w.fullPageMismatch * 100).toFixed(2)}%.`, '');
  lines.push('| Section | Status | Mismatch | Height Δ | Evidence |', '|---|---|---|---|---|');
  for (const s of w.sections) lines.push(`| ${s.id} | ${s.status} | ${s.mismatch !== undefined ? (s.mismatch * 100).toFixed(2) + '%' : '—'} | ${s.heightDelta ?? '—'} | ${s.reason || s.montage || ''} |`);
  if (w.extraCloneSections.length) lines.push('', `Extra sections in clone: ${w.extraCloneSections.map((s) => s.id).join(', ')}`);
  const a = w.audit;
  lines.push('', `Runtime: ${a.pageErrors.length} page errors, ${a.consoleErrors.length} console errors, ${a.failedRequests.length} failed requests, ${a.hotlinkedFromSource.length} hotlinks to source, overflow=${a.horizontalOverflow}, broken images=${a.brokenImages.length}`, '');
}
fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));

emit({
  ok: report.ok, verdict: report.verdict, report: path.join(out, 'report.md'),
  gates: Object.fromEntries(Object.entries(report.widths).map(([k, w]) => [k, w.gates])),
  worst: report.worst.slice(0, 8).map((s) => ({ width: s.width, id: s.id, status: s.status, mismatch: s.mismatch, heightDelta: s.heightDelta, reason: s.reason, montage: s.montage })),
  error: report.error,
});
process.exit(report.ok ? 0 : 1);
