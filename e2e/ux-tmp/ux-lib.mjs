import { mkdirSync, appendFileSync } from 'node:fs';
export const SHOT = '/tmp/claude-0/-home-user-splagame/99da03ea-b548-53d9-9f15-bb3c31d95516/scratchpad/ux/';
mkdirSync(SHOT, { recursive: true });

export const VPS = {
  d1920: { viewport: { width: 1920, height: 1080 } },
  d1280: { viewport: { width: 1280, height: 720 } },
  d1024: { viewport: { width: 1024, height: 640 } },
  land: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  port: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
};

export function log(file, obj) {
  const line = typeof obj === 'string' ? obj : JSON.stringify(obj);
  console.log(line);
  appendFileSync(`${SHOT}${file}.log`, line + '\n');
}

/** Relatório de layout: sobreposições entre grupos, texto cortado, fora da tela, alvos pequenos. */
export async function audit(page, label, groups = []) {
  return page.evaluate(({ label, groups }) => {
    const vw = innerWidth, vh = innerHeight;
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const desc = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
      const t = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return t ? `${s}「${t}」` : s;
    };
    const out = { label, overlaps: [], clipped: [], offscreen: [], smallTargets: [], lowContrast: [] };
    const inter = (a, b) => {
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return x * y;
    };
    for (const sel of groups) {
      const els = [...document.querySelectorAll(sel)].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return r.width * r.height < 0.45 * vw * vh; });
      for (let i = 0; i < els.length; i++)
        for (let j = i + 1; j < els.length; j++) {
          if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
          const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
          const ar = inter(a, b);
          if (ar > 16) out.overlaps.push(`${sel}: ${desc(els[i])} × ${desc(els[j])} (${Math.round(ar)}px², ${Math.round((100 * ar) / Math.min(a.width * a.height, b.width * b.height))}% do menor)`);
        }
    }
    // texto cortado
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || el.closest('canvas')) continue;
      const cs = getComputedStyle(el);
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const over = el.scrollWidth > el.clientWidth + 1 && (cs.overflow.includes('hidden') || cs.overflowX === 'hidden' || cs.overflowX === 'clip');
      if (over) out.clipped.push(`${desc(el)} sw=${el.scrollWidth} cw=${el.clientWidth} ellipsis=${cs.textOverflow === 'ellipsis'}`);
      const r = el.getBoundingClientRect();
      if (r.right > vw + 2 || r.bottom > vh + 2 || r.left < -2 || r.top < -2) {
        // só se nenhum ancestral rolável
        let p = el.parentElement, scroll = false;
        while (p) { const c = getComputedStyle(p); if (/(auto|scroll)/.test(c.overflowY + c.overflowX) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) { scroll = true; break; } p = p.parentElement; }
        if (!scroll) out.offscreen.push(`${desc(el)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`);
      }
    }
    // alvos pequenos
    for (const el of document.querySelectorAll('button, a, input, select, [role=tab], [role=radio], summary, label.toggle')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.smallTargets.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // contraste simples: cor do texto vs fundo efetivo (ignora fundos transparentes sobre a cena)
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      let p = el, bg = null;
      while (p) { const c = rgb(getComputedStyle(p).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.6)) { bg = c; break; } p = p.parentElement; }
      if (!bg) continue;
      const fg = rgb(cs.color); const alpha = (fg[3] ?? 1) * Number(cs.opacity);
      const f = fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
      const L1 = lum(f), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize);
      if (ratio < (size >= 18 ? 3 : 4.5)) out.lowContrast.push(`${desc(el)} ${ratio.toFixed(2)}:1 ${size}px`);
    }
    for (const k of ['clipped', 'offscreen', 'smallTargets', 'lowContrast']) out[k] = [...new Set(out[k])].slice(0, 25);
    return out;
  }, { label, groups });
}

export async function snap(page, name, file, groups) {
  await page.screenshot({ path: `${SHOT}${name}.png` });
  const a = await audit(page, name, groups);
  log(file, a);
  return a;
}
