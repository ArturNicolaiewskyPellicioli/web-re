#!/usr/bin/env node
// Capture trustworthy evidence from a source page.
// Usage: node capture.mjs <url> --out <dir> [--widths 1440,768,390] [--height 900] [--max-media-mb 40] [--states states.json]
// Prints a JSON summary; `ok:false` means the capture cannot be trusted (blocked, empty, error page).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  parseArgs, widthsFrom, ensureDir, writeJSON, emit, launch, newContext, settle, detectSectionsInPage, slugHost,
} from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
const url = args._[0];
if (!url) { emit({ ok: false, error: 'usage: capture.mjs <url> --out <dir>' }); process.exit(2); }
const out = path.resolve(args.out || `.clone/${slugHost(url)}/source`);
const widths = widthsFrom(args.widths).sort((a, b) => b - a);
const height = parseInt(args.height || '900', 10);
const maxMediaBytes = parseFloat(args['max-media-mb'] || '40') * 1024 * 1024;
const origin = new URL(url).origin;
ensureDir(out);

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/font-woff2': 'woff2', 'application/font-woff': 'woff', 'application/x-font-ttf': 'ttf',
  'text/css': 'css', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/json': 'json',
};
const assets = new Map(); // url -> record
const warnings = [];

function localName(u, type, ctype) {
  const clean = u.split(/[?#]/)[0];
  let base = path.basename(clean).replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 50) || 'asset';
  const ext = EXT[(ctype || '').split(';')[0].trim()] || (path.extname(clean).slice(1).toLowerCase() || 'bin');
  const hash = crypto.createHash('sha1').update(u).digest('hex').slice(0, 8);
  return path.join(type, `${base}-${hash}.${ext}`);
}

async function saveResponse(resp) {
  try {
    const req = resp.request();
    const type = req.resourceType();
    if (!['image', 'font', 'stylesheet', 'media'].includes(type)) return;
    const u = resp.url();
    if (u.startsWith('data:') || assets.has(u)) return;
    const status = resp.status();
    const ctype = resp.headers()['content-type'] || '';
    const rec = { url: u, type, status, contentType: ctype.split(';')[0], local: null, bytes: 0 };
    assets.set(u, rec);
    if (type === 'media') return; // downloaded later with a size cap (range responses are partial)
    if (status >= 300) return;
    const body = await resp.body();
    rec.local = localName(u, type === 'stylesheet' ? 'css' : type === 'font' ? 'fonts' : 'images', ctype);
    rec.bytes = body.length;
    ensureDir(path.join(out, 'assets', path.dirname(rec.local)));
    fs.writeFileSync(path.join(out, 'assets', rec.local), body);
  } catch { /* body unavailable (redirect/cancelled) */ }
}

// ---------- in-page extractors ----------
const extractTokens = () => {
  const els = [...document.querySelectorAll('body *')].slice(0, 6000);
  const count = (m, k) => { if (k && k !== 'none' && k !== 'normal' && k !== 'auto') m[k] = (m[k] || 0) + 1; };
  const colors = {}, bgs = {}, borders = {}, radii = {}, shadows = {}, spacing = {}, maxWidths = {}, gradients = {};
  const typo = {};
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      count(colors, cs.color);
      const key = [cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), cs.fontWeight, cs.fontSize, cs.lineHeight, cs.letterSpacing, cs.textTransform].join(' | ');
      typo[key] = typo[key] || { count: 0, family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, example: el.textContent.trim().slice(0, 40), tags: {} };
      typo[key].count++; typo[key].tags[el.tagName.toLowerCase()] = (typo[key].tags[el.tagName.toLowerCase()] || 0) + 1;
    }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') count(bgs, cs.backgroundColor);
    if (cs.backgroundImage.includes('gradient')) count(gradients, cs.backgroundImage);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') count(borders, `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`);
    if (cs.borderRadius !== '0px') count(radii, cs.borderRadius);
    count(shadows, cs.boxShadow);
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'])
      if (cs[p] && cs[p] !== '0px' && cs[p] !== 'normal') count(spacing, cs[p]);
    if (cs.maxWidth !== 'none') count(maxWidths, `${cs.maxWidth}`);
  }
  const top = (m, n = 40) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  // Root custom properties (same-origin sheets only; cross-origin CSS is parsed offline).
  const vars = {}; const media = new Set(); const fontFaces = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.media && rule.conditionText !== undefined) { media.add(rule.conditionText); if (rule.cssRules) walk(rule.cssRules); }
        else if (rule.cssRules && !rule.selectorText) walk(rule.cssRules);
        if (rule.selectorText && /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) {
          for (const p of rule.style) if (p.startsWith('--')) vars[p] = rule.style.getPropertyValue(p).trim();
        }
        if (rule.constructor.name === 'CSSFontFaceRule') fontFaces.push(rule.cssText.slice(0, 600));
      }
    };
    walk(rules);
  }
  const rootCS = getComputedStyle(document.documentElement);
  for (const k of Object.keys(vars)) vars[k] = rootCS.getPropertyValue(k).trim() || vars[k];
  const sample = {};
  for (const sel of ['h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'li', 'small', 'label', 'input', 'nav a', 'footer a']) {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0);
    if (!el) continue;
    const cs = getComputedStyle(el);
    sample[sel] = { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color, textTransform: cs.textTransform, text: el.textContent.trim().slice(0, 50) };
  }
  return {
    body: { background: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color, fontFamily: getComputedStyle(document.body).fontFamily },
    textColors: top(colors), backgrounds: top(bgs), gradients: top(gradients, 15), borders: top(borders, 20), radii: top(radii, 20),
    shadows: top(shadows, 15), spacing: top(spacing, 40), maxWidths: top(maxWidths, 15),
    typography: Object.values(typo).sort((a, b) => b.count - a.count).slice(0, 40), samples: sample,
    cssVariables: vars, mediaQueries: [...media], fontFaceRules: fontFaces.slice(0, 40),
  };
};

const extractDom = () => {
  const abs = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) }; };
  const images = [...document.images].filter((i) => i.getBoundingClientRect().width > 0).map((i) => ({
    src: i.currentSrc || i.src, srcset: i.srcset || null, sizes: i.sizes || null, alt: i.alt, natural: [i.naturalWidth, i.naturalHeight],
    rect: abs(i), objectFit: getComputedStyle(i).objectFit, objectPosition: getComputedStyle(i).objectPosition, loading: i.loading,
  }));
  const backgrounds = [];
  for (const el of document.querySelectorAll('body *')) {
    const bi = getComputedStyle(el).backgroundImage;
    if (bi && bi.includes('url(')) {
      const urls = [...bi.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => new URL(m[1], location.href).href);
      const cs = getComputedStyle(el);
      backgrounds.push({ urls, rect: abs(el), size: cs.backgroundSize, position: cs.backgroundPosition, repeat: cs.backgroundRepeat });
    }
  }
  const videos = [...document.querySelectorAll('video')].map((v) => ({
    src: v.currentSrc || v.src || v.querySelector('source')?.src, sources: [...v.querySelectorAll('source')].map((s) => ({ src: s.src, type: s.type })),
    poster: v.poster || null, autoplay: v.autoplay, loop: v.loop, muted: v.muted, playsInline: v.playsInline, controls: v.controls, rect: abs(v),
  }));
  const svgs = [...document.querySelectorAll('svg')].filter((s) => { const r = s.getBoundingClientRect(); return r.width >= 8 && r.height >= 8 && !s.closest('svg:not(:scope) svg'); })
    .slice(0, 300).map((s) => ({ rect: abs(s), html: s.outerHTML.length < 60000 ? s.outerHTML : null }));
  const iframes = [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, rect: abs(f), title: f.title }));
  const links = [...document.querySelectorAll('a[href]')].slice(0, 400).map((a) => ({ text: a.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), href: a.href, target: a.target || null }));
  const head = {
    title: document.title, lang: document.documentElement.lang,
    description: document.querySelector('meta[name=description]')?.content || null,
    og: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')].map((m) => [m.getAttribute('property'), m.content])),
    icons: [...document.querySelectorAll('link[rel*=icon]')].map((l) => ({ rel: l.rel, href: l.href, sizes: l.sizes?.value || null })),
    htmlClass: document.documentElement.className, bodyClass: document.body.className, themeColor: document.querySelector('meta[name=theme-color]')?.content || null,
  };
  return { head, images, backgrounds, videos, svgs, iframes, links, canvasCount: document.querySelectorAll('canvas').length };
};

const extractInteractions = () => {
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
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const pick = (sel, kind) => [...document.querySelectorAll(sel)].filter(vis).slice(0, 30).map((el) => ({
    kind, selector: cssPath(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
    ariaExpanded: el.getAttribute('aria-expanded'), ariaControls: el.getAttribute('aria-controls'),
  }));
  const carouselSel = '.swiper,.slick-slider,.embla,.splide,.glide,.flickity-enabled,.keen-slider,[aria-roledescription=carousel],[data-carousel]';
  return [
    ...pick('[aria-expanded]', 'disclosure'),
    ...pick('details > summary', 'details'),
    ...pick('[role=tab]', 'tab'),
    ...pick('[aria-haspopup]', 'popup'),
    ...pick(carouselSel, 'carousel'),
    ...pick('dialog,[role=dialog]', 'dialog'),
    ...pick('header button, nav button', 'nav-button'),
  ];
};

const detectLibs = () => {
  const w = window, html = document.documentElement;
  const scripts = [...document.scripts].map((s) => s.src).filter(Boolean);
  const has = (re) => scripts.some((s) => re.test(s));
  return {
    nextjs: !!(w.__NEXT_DATA__ || w.__next_f || document.querySelector('#__next') || has(/\/_next\//)),
    nuxt: !!(w.__NUXT__ || w.$nuxt), react: !!document.querySelector('[data-reactroot]') || !!w.React || !!w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size,
    vue: !!w.Vue || !!document.querySelector('[data-v-app]'), svelte: !!document.querySelector('[class*="svelte-"]'), astro: !!document.querySelector('astro-island'),
    framer: !!document.querySelector('[data-framer-name],[data-framer-component-type]') || has(/framerusercontent|framer\.com/),
    webflow: !!html.getAttribute('data-wf-page'), wordpress: has(/wp-content|wp-includes/), shopify: !!w.Shopify, wix: has(/parastorage|wixstatic/),
    gsap: !!w.gsap, scrollTrigger: !!w.ScrollTrigger, lenis: html.classList.contains('lenis') || !!w.lenis || !!w.Lenis, locomotive: html.classList.contains('has-scroll-smooth'),
    swiper: !!w.Swiper || !!document.querySelector('.swiper'), aos: !!document.querySelector('[data-aos]'), lottie: !!document.querySelector('lottie-player,dotlottie-player,[data-animation-path]') || !!w.lottie,
    three: !!w.THREE, webgl: [...document.querySelectorAll('canvas')].some((c) => { try { return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }),
    tailwindLike: /\b(flex|grid|px-\d|py-\d|text-(xs|sm|lg|xl)|bg-\w+-\d{2,3})\b/.test(document.body.innerHTML.slice(0, 200000)),
    scriptHosts: [...new Set(scripts.map((s) => { try { return new URL(s).hostname; } catch { return ''; } }))].filter(Boolean),
  };
};

// ---------- run ----------
const browser = await launch();
const summary = { ok: true, url, out, widths, pages: {}, warnings };
try {
  for (const [idx, width] of widths.entries()) {
    const ctx = await newContext(browser, width, height);
    const page = await ctx.newPage();
    page.on('response', saveResponse);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => ({ error: e.message }));
    if (resp?.error) { summary.ok = false; summary.error = resp.error; break; }
    const status = resp.status();
    await settle(page, { freeze: true });
    const integrity = await page.evaluate(() => ({
      textLength: document.body.innerText.trim().length, title: document.title,
      height: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth,
      challenge: /just a moment|attention required|captcha|access denied|verify you are human|are you a robot/i.test(document.body.innerText.slice(0, 3000) + document.title),
    }));
    if (status >= 400 || integrity.challenge || integrity.textLength < 80) {
      summary.ok = false;
      summary.error = `capture integrity failed at ${width}px: HTTP ${status}, text=${integrity.textLength} chars, challenge=${integrity.challenge}`;
    }
    const dir = ensureDir(path.join(out, 'screenshots', String(width)));
    await page.screenshot({ path: path.join(dir, 'full.png'), fullPage: true });
    await page.screenshot({ path: path.join(dir, 'viewport.png') });
    const sections = await page.evaluate(detectSectionsInPage);
    for (const s of sections) {
      if (s.rect.height < 4) continue;
      await page.screenshot({ path: path.join(dir, `${s.id}.png`), fullPage: true, clip: { x: 0, y: s.rect.y, width, height: Math.min(s.rect.height, 8000) } }).catch(() => {});
    }
    writeJSON(path.join(out, `sections-${width}.json`), { width, page: integrity, sections });
    summary.pages[width] = { status, height: integrity.height, sections: sections.length, horizontalOverflow: integrity.scrollWidth > width };
    if (idx === 0) {
      fs.writeFileSync(path.join(out, 'page.html'), await page.content());
      writeJSON(path.join(out, 'tokens.json'), await page.evaluate(extractTokens));
      const dom = await page.evaluate(extractDom);
      dom.svgs.forEach((s, i) => {
        if (!s.html) return;
        const f = path.join('svg', `inline-${String(i + 1).padStart(3, '0')}.svg`);
        ensureDir(path.join(out, 'assets', 'svg'));
        fs.writeFileSync(path.join(out, 'assets', f), s.html.includes('xmlns=') ? s.html : s.html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
        s.local = f; delete s.html;
      });
      writeJSON(path.join(out, 'dom.json'), dom);
      writeJSON(path.join(out, 'interaction-candidates.json'), await page.evaluate(extractInteractions));
      const libs = await page.evaluate(detectLibs);
      writeJSON(path.join(out, 'libs.json'), libs);
      const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => ({ family: f.family, weight: f.weight, style: f.style, unicodeRange: f.unicodeRange })));
      writeJSON(path.join(out, 'fonts-loaded.json'), fonts);
      if (libs.webgl || libs.three) warnings.push('WebGL/canvas rendering detected: runtime-drawn visuals have a fidelity ceiling; content still clones.');
      if (dom.canvasCount) warnings.push(`${dom.canvasCount} <canvas> element(s) present.`);
      if (dom.iframes.length) warnings.push(`${dom.iframes.length} iframe(s): third-party embeds are kept as embeds, not rebuilt.`);
      if (libs.framer) warnings.push('Framer site: read references/animacoes-e-motion.md before building.');
      if (libs.lenis || libs.locomotive || libs.scrollTrigger) warnings.push('Scroll-driven behavior (smooth scroll / ScrollTrigger) detected: reproduce with real wheel input and verify with interactions.mjs.');
    }
    await ctx.close();
  }

  // Videos: direct download with size cap.
  const dom = fs.existsSync(path.join(out, 'dom.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'dom.json'))) : { videos: [] };
  const mediaUrls = new Set([...assets.values()].filter((a) => a.type === 'media').map((a) => a.url));
  dom.videos.forEach((v) => { [v.src, ...v.sources.map((s) => s.src)].filter(Boolean).forEach((u) => mediaUrls.add(u)); });
  if (mediaUrls.size) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    for (const u of mediaUrls) {
      if (u.startsWith('blob:')) { warnings.push(`Streaming video (blob:) not downloadable: ${u}`); continue; }
      try {
        const r = await ctx.request.get(u, { timeout: 120000 });
        const body = await r.body();
        const rec = assets.get(u) || { url: u, type: 'media' };
        rec.status = r.status(); rec.contentType = (r.headers()['content-type'] || '').split(';')[0];
        if (r.ok() && body.length <= maxMediaBytes) {
          rec.local = localName(u, 'media', rec.contentType); rec.bytes = body.length;
          ensureDir(path.join(out, 'assets', 'media'));
          fs.writeFileSync(path.join(out, 'assets', rec.local), body);
        } else if (body.length > maxMediaBytes) warnings.push(`Video above cap (${Math.round(body.length / 1e6)} MB), kept remote: ${u}`);
        assets.set(u, rec);
      } catch (e) { warnings.push(`Video download failed: ${u} (${e.message})`); }
    }
    await ctx.close();
  }

  // Offline parse of saved CSS (covers cross-origin sheets): media queries, @font-face, :root vars.
  const cssMedia = new Set(), cssFontFaces = [];
  for (const a of assets.values()) {
    if (a.type !== 'stylesheet' || !a.local) continue;
    const css = fs.readFileSync(path.join(out, 'assets', a.local), 'utf8');
    for (const m of css.matchAll(/@media([^{]+)\{/g)) cssMedia.add(m[1].trim());
    for (const m of css.matchAll(/@font-face\s*\{[^}]*\}/g)) cssFontFaces.push({ sheet: a.url, rule: m[0].slice(0, 800) });
  }
  const tokensFile = path.join(out, 'tokens.json');
  if (fs.existsSync(tokensFile)) {
    const t = JSON.parse(fs.readFileSync(tokensFile));
    t.mediaQueries = [...new Set([...(t.mediaQueries || []), ...cssMedia])];
    const bp = new Set();
    for (const q of t.mediaQueries) for (const m of q.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) bp.add(`${m[1]} ${m[3] === 'px' ? m[2] : parseFloat(m[2]) * 16}px`);
    t.breakpoints = [...bp].sort((a, b) => parseFloat(a.split(' ')[1]) - parseFloat(b.split(' ')[1]));
    t.fontFaceRulesFromCss = cssFontFaces.slice(0, 60);
    writeJSON(tokensFile, t);
  }

  const list = [...assets.values()];
  writeJSON(path.join(out, 'assets.json'), list);
  const failed = list.filter((a) => a.status >= 400);
  if (failed.length) warnings.push(`${failed.length} asset request(s) failed on the source itself (status >= 400).`);
  summary.assets = {
    saved: list.filter((a) => a.local).length,
    byType: list.reduce((m, a) => ((m[a.type] = (m[a.type] || 0) + 1), m), {}),
    crossOrigin: list.filter((a) => !a.url.startsWith(origin)).length,
  };
  summary.files = ['screenshots/<width>/full.png', 'sections-<width>.json', 'tokens.json', 'dom.json', 'fonts-loaded.json', 'libs.json', 'interaction-candidates.json', 'assets.json', 'assets/', 'page.html'];
} catch (e) {
  summary.ok = false; summary.error = e.stack || String(e);
} finally {
  await browser.close();
}
writeJSON(path.join(out, 'capture-summary.json'), summary);
emit(summary);
process.exit(summary.ok ? 0 : 1);
