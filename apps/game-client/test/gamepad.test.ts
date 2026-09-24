import { describe, expect, it } from 'vitest';
import { DEFAULT_PAD_BINDS, GamepadHub, PAD, RumbleGate, applyCurve, buttonGlyph, padFamily, radialDeadzone } from '../src/game/input/gamepad';
import { AIM_ASSIST_TUNING, aimAssist } from '../src/game/input/aimAssist';
import { DEFAULT_SETTINGS, LEGACY_KEYS, SETTINGS_KEY, loadSettings, rebind, sanitizeSettings, type SettingsStorage } from '../src/app/settingsSchema';
import { hintLabel } from '../src/app/hints';

describe('família e glifos do controle', () => {
  it('reconhece Xbox, PlayStation e Nintendo pelo id do navegador', () => {
    expect(padFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padFamily('045e-02ea-Microsoft X-Box One S pad')).toBe('xbox');
    expect(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(padFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(padFamily('USB Gamepad (Vendor: 0079 Product: 0011)')).toBe('generico');
  });
  it('mostra o rótulo da família para o mesmo botão físico', () => {
    expect(buttonGlyph('xbox', PAD.NORTE)).toBe('Y');
    expect(buttonGlyph('playstation', PAD.NORTE)).toBe('△');
    expect(buttonGlyph('nintendo', PAD.NORTE)).toBe('X');
    expect(buttonGlyph('xbox', PAD.RT)).toBe('RT');
    expect(buttonGlyph('playstation', PAD.RT)).toBe('R2');
    expect(buttonGlyph('generico', 40)).toBe('Botão 41');
  });
  it('dicas mudam com o dispositivo: "E", "Y", "△", "Roda"', () => {
    const s = DEFAULT_SETTINGS;
    expect(hintLabel('special', 'teclado', s, 'xbox')).toBe('E');
    expect(hintLabel('special', 'controle', s, 'xbox')).toBe('Y');
    expect(hintLabel('special', 'controle', s, 'playstation')).toBe('△');
    expect(hintLabel('special', 'toque', s, 'xbox')).toBe('Roda');
    expect(hintLabel('fire', 'controle', s, 'playstation')).toBe('R2');
  });
});

describe('analógicos', () => {
  it('zona morta radial zera abaixo do limite e reescala sem salto', () => {
    expect(radialDeadzone(0.1, 0.05, 0.15)).toEqual([0, 0]);
    const [x] = radialDeadzone(0.16, 0, 0.15);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.02);
    const [fx, fy] = radialDeadzone(1, 0, 0.15);
    expect(fx).toBeCloseTo(1);
    expect(fy).toBe(0);
    // diagonal mantém a direção (sem "cruz")
    const [dx, dy] = radialDeadzone(0.5, 0.5, 0.15);
    expect(dx).toBeCloseTo(dy);
  });
  it('curva preserva direção, 0 e 1', () => {
    expect(applyCurve(0, 0, 'precisa')).toEqual([0, 0]);
    const [x, y] = applyCurve(0.6, 0.8, 'linear');
    expect(x).toBeCloseTo(0.6);
    expect(y).toBeCloseTo(0.8);
    const [px] = applyCurve(0.5, 0, 'precisa');
    expect(px).toBeLessThan(0.5);
    expect(applyCurve(1, 0, 'padrao')[0]).toBeCloseTo(1);
  });
});

function fakePad(index: number, id: string) {
  return { index, id, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), vibrationActuator: null };
}

describe('GamepadHub', () => {
  it('detecta conexão, bordas de botão, gatilho com histerese e desconexão', () => {
    const pads: Array<ReturnType<typeof fakePad> | null> = [fakePad(0, 'Xbox Controller (Vendor: 045e)')];
    const hub = new GamepadHub({ getGamepads: () => pads });
    const ev: string[] = [];
    hub.subscribe((e) => ev.push(e.type === 'press' || e.type === 'release' ? `${e.type}:${e.button}` : e.type));
    hub.poll();
    expect(ev).toEqual(['connected']);
    expect(hub.active?.family).toBe('xbox');
    pads[0]!.buttons[PAD.SUL] = { pressed: true, value: 1 };
    hub.poll();
    hub.poll(); // segurar não repete a borda
    pads[0]!.buttons[PAD.SUL] = { pressed: false, value: 0 };
    hub.poll();
    expect(ev.filter((e) => e.includes(':0'))).toEqual(['press:0', 'release:0']);
    // gatilho: aperta acima de 0,4, só solta abaixo de 0,25
    pads[0]!.buttons[PAD.RT] = { pressed: true, value: 0.45 };
    hub.poll();
    expect(hub.isPressed(PAD.RT)).toBe(true);
    pads[0]!.buttons[PAD.RT] = { pressed: true, value: 0.3 };
    hub.poll();
    expect(hub.isPressed(PAD.RT)).toBe(true);
    pads[0]!.buttons[PAD.RT] = { pressed: false, value: 0.2 };
    hub.poll();
    expect(hub.isPressed(PAD.RT)).toBe(false);
    // Bluetooth caindo sem evento: sumiu da lista = desconectado, botões soltos
    pads[0]!.buttons[PAD.LB] = { pressed: true, value: 1 };
    hub.poll();
    pads[0] = null;
    hub.poll();
    expect(ev.slice(-2)).toEqual(['release:4', 'disconnected']);
    expect(hub.active).toBeNull();
  });
  it('o último controle mexido assume', () => {
    const a = fakePad(0, 'Xbox (045e)');
    const b = fakePad(1, 'DualSense (054c)');
    const hub = new GamepadHub({ getGamepads: () => [a, b] });
    hub.poll();
    expect(hub.active?.index).toBe(0);
    b.axes = [0.9, 0, 0, 0];
    hub.poll();
    expect(hub.active?.family).toBe('playstation');
    expect(hub.frame.lx).toBeGreaterThan(0.8);
  });
});

describe('vibração', () => {
  it('respeita o intervalo por tipo e nunca vira vibração contínua', () => {
    const g = new RumbleGate();
    expect(g.allow('disparo', 0)).toBe(true);
    expect(g.allow('disparo', 50)).toBe(false);
    let allowed = 0;
    for (let t = 0; t < 1000; t += 16) if (g.allow('dano', t) || g.allow('disparo', t) || g.allow('moringa', t)) allowed++;
    expect(allowed).toBeLessThan(8);
  });
});

describe('assistência de mira', () => {
  const t = AIM_ASSIST_TUNING;
  it('sem alvo ou com força 0 não faz nada', () => {
    expect(aimAssist(0, 0, [], 1, 1, 1 / 60).slow).toBe(1);
    expect(aimAssist(0, 0, [{ yaw: 0, pitch: 0, dist: 10 }], 1, 0, 1 / 60).slow).toBe(1);
  });
  it('desacelera perto do alvo e puxa de leve só com entrada do jogador', () => {
    const target = { yaw: 0.05, pitch: 0, dist: 10 };
    const idle = aimAssist(0, 0, [target], 0, 1, 1 / 60);
    expect(idle.slow).toBeLessThan(1);
    expect(idle.dYaw).toBe(0); // parado: nada se move sozinho
    const aiming = aimAssist(0, 0, [target], 1, 1, 1 / 60);
    expect(aiming.dYaw).toBeGreaterThan(0);
    expect(aiming.dYaw).toBeLessThanOrEqual((t.pullRate * 1) / 60 + 1e-9);
  });
  it('ignora alvos fora da zona ou além do alcance', () => {
    expect(aimAssist(0, 0, [{ yaw: 0.6, pitch: 0, dist: 10 }], 1, 1, 1 / 60).target).toBe(-1);
    expect(aimAssist(0, 0, [{ yaw: 0, pitch: 0, dist: t.range + 5 }], 1, 1, 1 / 60).target).toBe(-1);
  });
});

function memStorage(init: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
}

describe('preferências versionadas', () => {
  it('valida tipos e faixas; valores adulterados voltam ao padrão', () => {
    const s = sanitizeSettings({ sensitivity: 99, fov: 'x', palette: '<script>', keybinds: { jump: 'Space', flow: 'Space' }, gamepad: { sensX: -3, curve: 'turbo', binds: { fire: 7.5 } } });
    expect(s.sensitivity).toBe(3);
    expect(s.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(s.palette).toBe('padrao');
    expect(s.keybinds).toEqual(DEFAULT_SETTINGS.keybinds); // duas ações na mesma tecla
    expect(s.gamepad.sensX).toBe(0.2);
    expect(s.gamepad.curve).toBe('padrao');
    expect(s.gamepad.binds.fire).toBe(DEFAULT_PAD_BINDS.fire);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('migra a v1 para a v2 preservando o que o jogador escolheu', () => {
    const v1 = { sensitivity: 1.7, invertY: true, flowMode: 'toggle', keybinds: { special: 'KeyR', map: 'KeyM' } };
    const st = memStorage({ [LEGACY_KEYS[0]]: JSON.stringify(v1) });
    const s = loadSettings(st);
    expect(s.version).toBe(2);
    expect(s.sensitivity).toBe(1.7);
    expect(s.invertY).toBe(true);
    expect(s.flowMode).toBe('toggle');
    expect(s.keybinds.special).toBe('KeyR');
    expect(s.gamepad.binds).toEqual(DEFAULT_PAD_BINDS);
    expect(st.data[SETTINGS_KEY]).toBeTruthy();
    expect(st.data[LEGACY_KEYS[0]]).toBeUndefined();
    // JSON quebrado não derruba o jogo
    expect(loadSettings(memStorage({ [SETTINGS_KEY]: '{oops' }))).toEqual(DEFAULT_SETTINGS);
  });
  it('remapear para um botão ocupado troca as duas ações', () => {
    const b = rebind(DEFAULT_PAD_BINDS, 'jump', DEFAULT_PAD_BINDS.special);
    expect(b.jump).toBe(PAD.NORTE);
    expect(b.special).toBe(PAD.SUL);
    expect(new Set(Object.values(b)).size).toBe(Object.values(b).length);
  });
});

import { nameplateVisible } from '../src/game/nameplates';
import { voiceByUser, initials, avatarHue } from '../src/app/profiles';

describe('nomes sobre os personagens e indicador de fala', () => {
  it('adversário atrás de parede ou submerso não mostra nome (nem se está falando)', () => {
    const base = { ally: false, alive: true, submerged: false, dist: 10, los: true };
    expect(nameplateVisible(base)).toBe(true);
    expect(nameplateVisible({ ...base, los: false })).toBe(false);
    expect(nameplateVisible({ ...base, submerged: true })).toBe(false);
    expect(nameplateVisible({ ...base, dist: 60 })).toBe(false);
    // aliado: a posição já é pública no mapa tático
    expect(nameplateVisible({ ...base, ally: true, los: false, submerged: true })).toBe(true);
    expect(nameplateVisible({ ...base, ally: true, alive: false })).toBe(false);
  });
  it('liga participante da chamada ao jogador por userId (ou id), só com a chamada conectada', () => {
    const voice = { available: true, reason: 'ok' as const, connected: true, muted: false, scope: 'shared_call' as const, participants: [
      { id: 'lk-1', userId: 'ana', displayName: 'Aninha', speaking: true, muted: false, isLocal: true },
      { id: 'bruno', displayName: 'Bruno', speaking: true, muted: true, isLocal: false },
    ] };
    const m = voiceByUser(voice);
    expect(m.get('ana')).toEqual({ speaking: true, muted: false });
    expect(m.get('bruno')).toEqual({ speaking: false, muted: true }); // mudo nunca aparece "falando"
    expect(voiceByUser({ ...voice, connected: false }).size).toBe(0);
  });
  it('iniciais e cor neutra estável, fora das cores das turmas', () => {
    expect(initials('Aninha')).toBe('AN');
    expect(initials('Davi, o Destruidor')).toBe('DD');
    expect(initials('🎨')).toBe('?');
    for (const k of ['ana', 'bruno', 'carla', 'x', 'y', 'z']) {
      const h = avatarHue(k);
      expect((h >= 80 && h < 170) || (h >= 290 && h < 340)).toBe(true);
    }
  });
});
