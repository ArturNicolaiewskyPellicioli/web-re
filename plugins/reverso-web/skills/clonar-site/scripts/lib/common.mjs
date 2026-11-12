// Shared helpers: argument parsing, deterministic browser setup, page settling,
// section detection and PNG utilities. Everything here is deterministic.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export function parseArgs(argv, defaults = {}) {
  const out = { _: [], ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export const widthsFrom = (v, fallback = '1440,768,390') =>
  String(v || fallback).split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
export function writeJSON(file, data) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
export function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function emit(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

export async function launch() {
  return chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'] });
}

export async function newContext(browser, width, height = 900) {
  const mobile = width < 600;
  return browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: false, // keep layout viewport == width; touch emulation changes too much between runs
    hasTouch: mobile,
    userAgent: mobile ? MOBILE_UA : DESKTOP_UA,
    locale: 'pt-BR',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    ignoreHTTPSErrors: true,
  });
}

const FREEZE_CSS = `
*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;
transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;}
html{scroll-behavior:auto!important}`;

// Bring the page to a stable, fully revealed state: fonts loaded, lazy media loaded,
// scroll-reveal sections triggered, videos parked on frame 0, then (optionally) freeze motion.
export async function settle(page, { freeze = true, maxScrolls = 80, masks = [] } = {}) {
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  // Real wheel input so smooth-scroll libraries (Lenis, Locomotive) also advance.
  const vh = page.viewportSize().height;
  for (let i = 0; i < maxScrolls; i++) {
    const { y, max } = await page.evaluate(() => ({
      y: window.scrollY,
      max: document.documentElement.scrollHeight - window.innerHeight,
    }));
    if (y >= max - 2) break;
    await page.mouse.wheel(0, Math.round(vh * 0.8));
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(500);
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100000);
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const imgs = [...document.images].filter((i) => !i.complete);
    await Promise.race([
      Promise.all(imgs.map((i) => i.decode().catch(() => {}))),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    document.querySelectorAll('video').forEach((v) => { try { v.pause(); v.currentTime = 0; } catch {} });
  });
  if (freeze) await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  if (masks.length) {
    await page.evaluate((sels) => {
      for (const s of sels) document.querySelectorAll(s).forEach((el) => { el.style.visibility = 'hidden'; });
    }, masks);
  }
  await page.waitForTimeout(300);
}

// Runs in the page. Finds the top-level visual sections of the document.
// Clone pages may mark sections explicitly with data-clone-section="<id>".
export const detectSectionsInPage = () => {
  const marked = [...document.querySelectorAll('[data-clone-section]')];
  const absRect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const cssPath = (el) => {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      const tag = el.tagName.toLowerCase();
      const sibs = [...el.parentElement.children].filter((c) => c.tagName === el.tagName);
      parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(el) + 1})` : tag);
      el = el.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height >= 24 && r.width >= 100;
  };
  const describe = (el, i, idOverride) => {
    const h = el.querySelector('h1,h2,h3,[role=heading]');
    const label = (h?.textContent || el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const slug = (idOverride || `${el.tagName.toLowerCase()}-${label}`).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return {
      id: idOverride || `s${String(i + 1).padStart(2, '0')}-${slug || 'section'}`,
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      label,
      rect: absRect(el),
      position: getComputedStyle(el).position,
      background: getComputedStyle(el).backgroundColor,
    };
  };
  if (marked.length) return marked.filter(visible).map((el, i) => describe(el, i, el.getAttribute('data-clone-section')));

  // Descend through single-child wrappers (#__next, #root, framer wrappers, etc.).
  let root = document.body;
  for (let depth = 0; depth < 8; depth++) {
    const kids = [...root.children].filter((c) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK'].includes(c.tagName) && visible(c));
    if (kids.length === 1) root = kids[0]; else break;
  }
  let candidates = [];
  for (const c of root.children) {
    if (!visible(c)) continue;
    // Expand <main> (and big generic wrappers) into their children.
    const isMain = c.tagName === 'MAIN' || c.getAttribute('role') === 'main';
    const tooTall = c.getBoundingClientRect().height > innerHeight * 4 && c.children.length > 1;
    if (isMain || (tooTall && c.tagName === 'DIV')) {
      const inner = [...c.children].filter(visible);
      if (inner.length > 1) { candidates.push(...inner); continue; }
    }
    candidates.push(c);
  }
  // Fixed/sticky headers keep their own entry; overlapping duplicates are dropped.
  candidates = candidates.filter((el, i, arr) => arr.findIndex((o) => o !== el && o.contains(el)) === -1);
  return candidates.map((el, i) => describe(el, i));
};

// ---------- PNG helpers ----------
export const readPNG = (f) => PNG.sync.read(fs.readFileSync(f));
export const writePNG = (f, png) => { ensureDir(path.dirname(f)); fs.writeFileSync(f, PNG.sync.write(png)); };

export function crop(png, x, y, w, h) {
  x = Math.max(0, Math.min(x, png.width)); y = Math.max(0, Math.min(y, png.height));
  w = Math.max(1, Math.min(w, png.width - x)); h = Math.max(1, Math.min(h, png.height - y));
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * png.width + x) * 4;
    png.data.copy(out.data, row * w * 4, s, s + w * 4);
  }
  return out;
}

// Pad to a target size with magenta so missing area counts as a difference.
export function padTo(png, w, h) {
  if (png.width === w && png.height === h) return png;
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 255; out.data[i + 3] = 255; }
  for (let row = 0; row < Math.min(h, png.height); row++) {
    const len = Math.min(w, png.width) * 4;
    png.data.copy(out.data, row * w * 4, row * png.width * 4, row * png.width * 4 + len);
  }
  return out;
}

// Compare two PNGs. Size differences are counted as mismatch (padding), never hidden.
export function diffPNG(a, b, { threshold = 0.1 } = {}) {
  const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
  const A = padTo(a, w, h), B = padTo(b, w, h);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(A.data, B.data, diff.data, w, h, { threshold, includeAA: false, alpha: 0.2 });
  return { mismatched: n, total: w * h, ratio: n / (w * h), diff, width: w, height: h };
}

// ref | cand | diff side by side (scaled down if very tall).
export function montage(a, b, d, maxHeight = 2400) {
  const gap = 12;
  const h = Math.min(Math.max(a.height, b.height, d.height), maxHeight);
  const w = a.width + b.width + d.width + gap * 2;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  let x0 = 0;
  for (const img of [a, b, d]) {
    for (let row = 0; row < Math.min(h, img.height); row++) {
      img.data.copy(out.data, (row * w + x0) * 4, row * img.width * 4, (row + 1) * img.width * 4);
    }
    x0 += img.width + gap;
  }
  return out;
}

export function slugHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-'); } catch { return 'site'; }
}
