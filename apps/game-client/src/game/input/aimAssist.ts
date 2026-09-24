/**
 * Assistência de mira LEVE, só para controle. Não é mira automática:
 *  - "fricção": perto de um adversário visível, a câmera gira mais devagar;
 *  - "magnetismo": enquanto o jogador está mirando ou andando, a mira é
 *    puxada muito de leve para o centro do alvo. Parado, nada se move sozinho.
 * Só recebe alvos que o cliente já desenha (vivos, fora da tinta, com linha de
 * visão): nunca revela quem está escondido. Tudo é apresentação local; o
 * servidor continua validando cada disparo.
 */

export const AIM_ASSIST_TUNING = {
  /** Alcance máximo (m). */
  range: 36,
  /** Raio da zona de fricção ao redor do centro do alvo (m). */
  zoneRadius: 1.25,
  /** Ângulo mínimo da zona (rad), para alvos muito longe não sumirem. */
  minZoneAngle: 0.02,
  /** Sensibilidade no centro do alvo com força 1 (0.6 = 40% mais lenta). */
  minSlow: 0.6,
  /** Magnetismo máximo com força 1 (rad/s). */
  pullRate: 0.32,
  /** Entrada mínima (analógico direito ou movimento) para o magnetismo agir. */
  pullNeedsInput: 0.15,
} as const;

export type AimAssistTuning = { -readonly [K in keyof typeof AIM_ASSIST_TUNING]: number };

export interface AimTarget {
  /** Direção da câmera até o centro do alvo. */
  yaw: number;
  pitch: number;
  dist: number;
}

export interface AimAssistResult {
  /** Multiplicador da sensibilidade do analógico (1 = sem efeito). */
  slow: number;
  dYaw: number;
  dPitch: number;
  /** Índice do alvo que influenciou (−1 = nenhum), para depuração. */
  target: number;
}

export const NO_ASSIST: AimAssistResult = { slow: 1, dYaw: 0, dPitch: 0, target: -1 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function aimAssist(camYaw: number, camPitch: number, targets: readonly AimTarget[], inputMag: number, strength: number, dt: number, tuning: AimAssistTuning = AIM_ASSIST_TUNING): AimAssistResult {
  if (strength <= 0 || targets.length === 0) return NO_ASSIST;
  let best = -1;
  let bestNorm = 1;
  let bestDy = 0;
  let bestDp = 0;
  let bestAng = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.dist > tuning.range || t.dist <= 0.5) continue;
    const dy = wrap(t.yaw - camYaw);
    const dp = t.pitch - camPitch;
    const ang = Math.hypot(dy * Math.cos(camPitch), dp);
    const zone = Math.max(tuning.minZoneAngle, Math.atan(tuning.zoneRadius / t.dist));
    const norm = ang / zone;
    if (norm < bestNorm) {
      bestNorm = norm;
      best = i;
      bestDy = dy;
      bestDp = dp;
      bestAng = ang;
    }
  }
  if (best < 0) return NO_ASSIST;
  const s = Math.min(1, strength);
  const closeness = 1 - bestNorm; // 1 no centro, 0 na borda da zona
  const slow = 1 - (1 - tuning.minSlow) * s * closeness;
  let dYaw = 0;
  let dPitch = 0;
  if (inputMag >= tuning.pullNeedsInput && bestAng > 1e-4) {
    const step = Math.min(bestAng, tuning.pullRate * s * Math.min(1, inputMag) * dt);
    dYaw = (bestDy / bestAng) * step;
    dPitch = (bestDp / bestAng) * step;
  }
  return { slow, dYaw, dPitch, target: best };
}
