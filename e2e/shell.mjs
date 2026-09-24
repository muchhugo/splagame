// Host de laboratório ⇄ Atividade no navegador: handshake, sandbox, voz não
// configurada, abrir/fechar 10× sem vazamento e usuário sem acesso (403).
import { HOST_URL, OUT, check, done, launch, watchErrors } from './lib.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = watchErrors(page, 'host');
const counters = async () => (await page.locator('.counters').innerText()).replace(/\s+/g, ' ');

await page.goto(HOST_URL);
await page.locator('aside[aria-label=Canal] select').selectOption('ana');
await page.waitForFunction(() => document.body.innerText.includes('sessão de desenvolvimento: Ana'));
const t0 = Date.now();
await page.click('button:has-text("Abrir Borrifo")');
const iframe = await page.waitForSelector('.slot iframe');
const src = await iframe.getAttribute('src');
check((await iframe.getAttribute('sandbox')) === 'allow-scripts allow-same-origin allow-pointer-lock', 'iframe com sandbox restrito');
check(!/camera|microphone/.test((await iframe.getAttribute('allow')) ?? ''), 'iframe sem permissão de câmera/microfone');
check(!src.includes('?') && src.includes('#'), 'nonce e sessão no fragmento da URL, nada na query');
const frame = await iframe.contentFrame();
await frame.waitForFunction(() => window.__borrifo?.uiStore.get().screen === 'lobby', null, { timeout: 120000 });
console.log(`     handshake + credencial + lobby em ${Date.now() - t0} ms`);
check((await frame.locator('text=Voz não configurada neste ambiente').count()) > 0, 'voz aparece como "não configurada" (nada simulado)');
await page.screenshot({ path: `${OUT}shell-aberto.png` });

await page.click('button:has-text("Fechar Atividade")');
await page.waitForFunction(() => !document.querySelector('.slot iframe'));
await page.waitForTimeout(300);
check(/hosts ativos: 0 iframes: 0 ouvintes: 0/.test(await counters()), 'fechar libera host, iframe e ouvintes');

await page.click('button:has-text("Abrir/fechar 10×")');
await page.waitForFunction(() => /teste de vazamento (concluído|interrompido)/.test(document.body.innerText), null, { timeout: 180000 });
check(/teste de vazamento concluído: hosts ativos 0, iframes 0, ouvintes 0 \(ok\)/.test(await page.evaluate(() => document.body.innerText)), 'abrir/fechar 10× termina sem vazamento');

await page.locator('aside[aria-label=Canal] select').selectOption('hugo');
await page.waitForFunction(() => document.body.innerText.includes('sessão de desenvolvimento: Hugo'));
await page.click('button:has-text("Abrir Borrifo")');
const f2 = await (await page.waitForSelector('.slot iframe')).contentFrame();
await f2.waitForSelector('text=Sem acesso a esta partida', { timeout: 60000 });
check(true, 'usuário fora do canal vê "Sem acesso a esta partida"');
check(/forbidden/.test(await page.evaluate(() => document.body.innerText)), 'host registra erro forbidden da Atividade');
await page.click('button:has-text("Fechar Atividade")');

check(errs.length === 0, `sem erros de página no host (${errs.length})`);
await browser.close();
done();
