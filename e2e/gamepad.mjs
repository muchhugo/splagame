// Controle SIMULADO numa partida real: `navigator.getGamepads` é substituído por
// um controle falso que o teste mexe (o Playwright não emula gamepads). Valida a
// integração do jogo com a Gamepad API — detecção, dicas, movimento, câmera,
// disparo, mapa, menu, remapeamento, vibração e troca de dispositivo — e NÃO o
// hardware nem o driver de um controle físico.
import { OUT, check, done, launch, openStandalone, watchErrors } from './lib.mjs';

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const DUALSENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

function fakePadInit() {
  const mk = (id) => ({
    id,
    index: 0,
    mapping: 'standard',
    connected: true,
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: {
      effects: ['dual-rumble'],
      playEffect(type, p) {
        window.__rumbles.push({ type, ...p, t: performance.now() });
        return Promise.resolve('complete');
      },
    },
  });
  window.__rumbles = [];
  window.__pad = null;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad] });
  const fire = (type, gamepad) => {
    const e = new Event(type);
    Object.defineProperty(e, 'gamepad', { value: gamepad });
    window.dispatchEvent(e);
  };
  window.__padConnect = (id) => {
    window.__pad = mk(id);
    fire('gamepadconnected', window.__pad);
  };
  window.__padDisconnect = () => {
    const p = window.__pad;
    p.connected = false;
    window.__pad = null;
    fire('gamepaddisconnected', p);
  };
  window.__padSet = (btn, v) => {
    const b = window.__pad.buttons[btn];
    b.value = v;
    b.pressed = v > 0.5;
  };
  window.__padAxes = (a) => {
    window.__pad.axes = a;
  };
}

const sid = `e2e-pad-${Date.now().toString(36)}`;
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 640 } });
await ctx.addInitScript(fakePadInit);
const page = await ctx.newPage();
const errs = watchErrors(page, 'ana');
await openStandalone(page, 'ana', sid);

const press = async (btn, ms = 250) => {
  await page.evaluate((b) => window.__padSet(b, 1), btn);
  await page.waitForTimeout(ms);
  await page.evaluate((b) => window.__padSet(b, 0), btn);
  await page.waitForTimeout(250);
};
const notices = () => page.evaluate(() => window.__borrifo.uiStore.get().notices.map((n) => n.text));
const ui = (k) => page.evaluate((key) => window.__borrifo.uiStore.get()[key], k);

// ---------------- detecção e dicas no lobby
await page.evaluate((id) => window.__padConnect(id), XBOX);
await page.waitForTimeout(400);
check((await notices()).some((t) => t === 'Controle conectado (Xbox)'), 'aviso "Controle conectado (Xbox)"');
await press(13); // direcional para baixo: vira o dispositivo ativo (e pula a abertura)
await page.waitForTimeout(600);
await press(5); // RB: próxima aba do lobby (Partida, onde ficam os comandos)
check((await page.textContent('.hub-tab[aria-selected=true]')) === 'Partida', 'RB troca de aba no lobby (Sala → Partida)');
const lobbyKeys = await page.textContent('.keys');
await press(4); // LB: volta para a Sala
check((await page.textContent('.hub-tab[aria-selected=true]')) === 'Sala', 'LB volta de aba no lobby');
check(/Y\s*Roda de Oleiro/.test(lobbyKeys) && /RT\s*usar ferramenta/.test(lobbyKeys) && /LS\s*mover/.test(lobbyKeys), `lobby mostra botões do Xbox (${lobbyKeys.replace(/\s+/g, ' ').slice(0, 120)}…)`);
const focusBefore = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 30));
await press(13);
const focusAfter = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 30));
check(focusAfter && focusAfter !== focusBefore, `direcional move o foco na interface ("${focusBefore}" → "${focusAfter}")`);
await press(9); // Menu
check((await ui('menuOpen')) === true, 'Menu abre o menu no lobby');
await press(1); // B volta
check((await ui('menuOpen')) === false, 'B fecha o menu');

// ---------------- partida
await page.click('text=Começar partida');
await page.waitForFunction(() => window.__borrifo.uiStore.get().lobby?.phase === 'running', null, { timeout: 60000 });
await page.waitForFunction(() => window.__borrifo.controller.runtime?.predictor?.state.alive, null, { timeout: 20000 });
const st = () => page.evaluate(() => { const rt = window.__borrifo.controller.runtime; const s = rt.predictor.state; return { pos: [...s.pos], ink: s.ink, yaw: rt.input.yaw, pitch: rt.input.pitch, device: document.documentElement.classList.contains('pad-nav') }; });
await page.evaluate(() => window.__padAxes([0, -1, 0, 0])); // analógico esquerdo para frente
await page.waitForTimeout(2500);
await page.evaluate(() => window.__padAxes([0, 0, 0, 0]));
const s0 = await st();
const moved = await page.evaluate(() => window.__borrifo.controller.runtime.predictor.state.pos);
const s1 = await st();
const spawn = await page.evaluate(() => { const rt = window.__borrifo.controller.runtime; return rt.map.spawns?.[rt.myTeam]?.[0] ?? null; });
check(s1.device, 'dispositivo ativo = controle durante a partida');
console.log(`     posição após andar com o analógico: ${moved.map((v) => v.toFixed(1)).join(', ')}`);
await page.evaluate(() => window.__padAxes([0, 0, 1, 0])); // analógico direito para a direita
await page.waitForTimeout(700);
await page.evaluate(() => window.__padAxes([0, 0, 0, 0]));
const s2 = await st();
check(s2.yaw - s0.yaw > 0.5, `analógico direito gira a câmera (yaw ${s0.yaw.toFixed(2)} → ${s2.yaw.toFixed(2)})`);
// andou? compara com uma segunda janela de movimento, medindo deslocamento real
const p0 = await page.evaluate(() => [...window.__borrifo.controller.runtime.predictor.state.pos]);
await page.evaluate(() => window.__padAxes([0, -1, 0, 0]));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__padAxes([0, 0, 0, 0]));
const p1 = await page.evaluate(() => [...window.__borrifo.controller.runtime.predictor.state.pos]);
const dist = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
check(dist > 1.5, `analógico esquerdo move o personagem (${dist.toFixed(1)} m em 1,5 s)`);
void spawn;

await page.evaluate(() => (window.__rumbles.length = 0));
await page.evaluate(() => window.__padSet(7, 1)); // RT segurado
await page.waitForTimeout(1500);
await page.evaluate(() => window.__padSet(7, 0));
const s3 = await st();
const rumbles = await page.evaluate(() => window.__rumbles.slice());
check(s3.ink < 95, `RT dispara (pigmento ${s3.ink.toFixed(0)}%)`);
console.log(`     pulsos: ${rumbles.map((r) => `${r.duration} ms @${Math.round(r.t - rumbles[0].t)}`).join(', ')}`);
check(rumbles.length >= 1 && rumbles.length <= 2, `vibração curta ao começar a rajada, não a cada gota (${rumbles.length} pulso(s), ${rumbles[0]?.duration ?? '-'} ms)`);
check(rumbles.every((r) => r.type === 'dual-rumble' && r.duration <= 400 && r.strongMagnitude <= 1 && r.weakMagnitude <= 1), 'vibração usa dual-rumble com duração e intensidade limitadas');
check((await page.textContent('.equip kbd')) === 'RB', 'HUD mostra RB para a Moringa');

await page.evaluate(() => window.__padSet(8, 1)); // View segurado
await page.waitForTimeout(500);
check((await ui('mapOpen')) === true, 'View abre o mapa tático (segurar)');
await page.screenshot({ path: `${OUT}controle-mapa.png` });
await page.evaluate(() => window.__padSet(8, 0));
await page.waitForTimeout(400);
check((await ui('mapOpen')) === false, 'soltar View fecha o mapa');

// ---------------- troca de dispositivo no meio da partida (sem pausar)
await page.focus('canvas');
await page.keyboard.press('KeyW');
await page.waitForTimeout(200);
check((await page.textContent('.equip kbd')) === 'Q', 'tecla do teclado → dicas voltam a mostrar teclas (Q)');
check((await page.evaluate(() => window.__borrifo.uiStore.get().lobby.phase)) === 'running', 'a partida continua durante a troca');
await press(13);
check((await page.textContent('.equip kbd')) === 'RB', 'controle de novo → RB');
await page.screenshot({ path: `${OUT}controle-hud.png` });

// ---------------- PlayStation
await page.evaluate(() => window.__padDisconnect());
await page.waitForTimeout(400);
check((await notices()).includes('Controle desconectado'), 'aviso "Controle desconectado"');
await page.evaluate((id) => window.__padConnect(id), DUALSENSE);
await page.waitForTimeout(400);
check((await notices()).includes('Controle conectado (PlayStation)'), 'aviso "Controle conectado (PlayStation)"');
await press(13);
check((await page.textContent('.equip kbd')) === 'R1', 'DualSense → HUD mostra R1');

// ---------------- configurações pelo controle
await press(9); // Options
check((await ui('menuOpen')) === true, 'Options abre o menu durante a partida');
// só pelo controle: ↓ até "Configurações" e ✕ confirma (um clique de mouse mudaria o dispositivo para teclado)
await press(13);
check((await page.evaluate(() => document.activeElement?.textContent)) === 'Configurações', 'direcional chega em "Configurações" no menu');
await press(0);
await page.waitForSelector('[role=tab][aria-selected=true]');
const tabNow = await page.textContent('[role=tab][aria-selected=true]');
check(tabNow === 'Controles', `configurações abrem na aba do dispositivo em uso (${tabNow})`);
await press(5); // R1: próxima aba
check((await page.textContent('[role=tab][aria-selected=true]')) === 'Toque', 'R1 troca de aba');
await press(4); // L1: volta
check((await page.textContent('[role=tab][aria-selected=true]')) === 'Controles', 'L1 volta de aba');
check(/Conectado: controle PlayStation/.test(await page.textContent('.settings')), 'aba Controle mostra o controle detectado');
await page.click('.setting:has-text("Pular") .keybtn');
await press(2); // □
let binds = await page.evaluate(() => JSON.parse(localStorage.getItem('borrifo.settings.v2')).gamepad.binds);
check(binds.jump === 2, 'remapear "Pular" para □ (salvo em borrifo.settings.v2)');
await page.click('.setting:has-text("Roda de Oleiro") .keybtn');
await press(2);
binds = await page.evaluate(() => JSON.parse(localStorage.getItem('borrifo.settings.v2')).gamepad.binds);
check(binds.special === 2 && binds.jump === 3, 'botão ocupado: as duas ações trocam (sem conflito)');
await page.screenshot({ path: `${OUT}controle-configuracoes.png` });
await page.click('text=Restaurar padrão do controle');
binds = await page.evaluate(() => JSON.parse(localStorage.getItem('borrifo.settings.v2')).gamepad.binds);
check(binds.jump === 0 && binds.special === 3, 'restaurar padrão do controle');
await page.evaluate(() => (window.__rumbles.length = 0));
await page.click('text=Testar vibração');
check((await page.evaluate(() => window.__rumbles.length)) === 1, 'botão "Testar vibração" aciona o controle');
await press(1); // ○ volta (fecha configurações)
await page.waitForTimeout(200);

check(errs.length === 0, `sem erros de página${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
done();
