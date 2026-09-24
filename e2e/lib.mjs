// Utilitários dos testes de navegador (Playwright). Exigem `pnpm dev` rodando:
// host em :3000, jogo em :5173 (build de desenvolvimento) e servidor em :2567.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

export const HOST_URL = process.env.E2E_HOST_URL ?? 'http://localhost:3000/';
export const GAME_URL = process.env.E2E_GAME_URL ?? 'http://localhost:5173/';
export const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** Sem GPU (CI/containers), E2E_SWIFTSHADER=1 usa renderização por CPU: lenta, mas funcional. */
export async function launch() {
  const args = process.env.E2E_SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [];
  return chromium.launch({ args: [...args, '--enable-precise-memory-info'], executablePath: process.env.E2E_CHROMIUM_PATH || undefined });
}

export function watchErrors(page, label) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errs.push(`${label} console: ${m.text().slice(0, 200)}`));
  return errs;
}

let failures = 0;
export function check(cond, msg) {
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${msg}`);
  if (!cond) failures++;
}
export function done() {
  console.log(failures ? `\n${failures} verificação(ões) falharam` : '\ntodas as verificações passaram');
  process.exit(failures ? 1 : 0);
}

/** Rota standalone de desenvolvimento do jogo (mesmo contrato de Atividade). */
export async function openStandalone(page, user, sessionId) {
  await page.goto(GAME_URL);
  await page.waitForSelector('select');
  await page.selectOption('select', user);
  await page.fill('input', sessionId);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
}

export async function startMatch(page) {
  await page.click('text=Começar partida');
  await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
}
