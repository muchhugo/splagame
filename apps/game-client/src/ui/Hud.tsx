import { useEffect, useRef } from 'react';
import { BUFFS, CORREIO, MUTIRAO } from '@borrifo/game-content';
import { usePop } from './motion';
import { INK, MORINGA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { hudDom, hudStore } from '../game/hud';
import { pressText, useHints } from '../app/hints';
import { useTeams } from '../app/teams';
import { VoiceChip } from './VoiceChip';
import { RoundIntro } from './RoundIntro';

function fmtTime(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Hud() {
  const h = useStore(hudStore, (s) => s);
  const locked = useStore(uiStore, (s) => s.pointerLocked);
  const menu = useStore(uiStore, (s) => s.menuOpen);
  const conn = useStore(uiStore, (s) => s.connection);
  const rtt = useStore(uiStore, (s) => s.rttMs);
  const result = useStore(uiStore, (s) => s.result);
  const lobbyDuration = useStore(uiStore, (s) => s.lobby?.roundDurationSeconds);
  const hints = useHints();
  const teams = useTeams();
  // refs por callback: reticle, hitmarker e bloqueio desmontam na morte e voltam no
  // reaparecimento; o runtime precisa sempre do nó ATUAL (senão escreve num nó solto)
  const refReticle = (el: HTMLDivElement | null) => void (hudDom.reticle = el);
  const refBlocked = (el: HTMLDivElement | null) => void (hudDom.blocked = el);
  const refHit = (el: HTMLDivElement | null) => void (hudDom.hitmarker = el);
  const refDamage = (el: HTMLDivElement | null) => void (hudDom.damage = el);
  const refPlates = (el: HTMLDivElement | null) => void (hudDom.nameplates = el);
  const spec = h.spectating;
  const w = WEAPONS[h.weaponId];
  const low = h.ink < INK.lowThreshold;
  const inkColor = `var(--team${h.myTeam})`;
  const nextCost = w.kind === 'automatic' ? w.inkCost : w.kind === 'contact' ? w.flickCost : w.minCost;
  const t0 = h.roster.filter((r) => r.team === 0);
  const t1 = h.roster.filter((r) => r.team === 1);
  const specialReady = h.special >= 100 && !h.specialActive;
  const urgent = h.phase === 'running' && h.timeLeftMs < 30000;
  const circ = 2 * Math.PI * 32;

  return (
    <div className="hud" aria-hidden={false}>
      <div className="damage-vignette" ref={refDamage} />
      <div className="nameplates" ref={refPlates} aria-hidden="true" />
      <div className="hud-top">
        <div className="roster" aria-label={`Turma ${teams[0].name}`}>
          {t0.map((r) => (
            <div key={r.playerId} data-player={r.playerId} data-speaking={r.speaking ? 'true' : 'false'} className={`dot ${r.alive ? '' : 'dead'} ${r.isMe ? 'me' : ''} ${r.specialReady ? 'ready' : ''} ${r.speaking ? 'speaking' : ''}`} style={{ background: 'var(--team0)' }} title={r.speaking ? `${r.name} (falando)` : r.name}>
              {teams[0].symbol}
            </div>
          ))}
        </div>
        <div className={`timer ${urgent ? 'urgent' : ''}`} aria-label="Tempo restante">
          {h.phase === 'countdown' ? fmtTime((lobbyDuration ?? 180) * 1000) : fmtTime(h.timeLeftMs)}
        </div>
        <div className="roster" aria-label={`Turma ${teams[1].name}`}>
          {t1.map((r) => (
            <div key={r.playerId} data-player={r.playerId} data-speaking={r.speaking ? 'true' : 'false'} className={`dot ${r.alive ? '' : 'dead'} ${r.isMe ? 'me' : ''} ${r.specialReady ? 'ready' : ''} ${r.speaking ? 'speaking' : ''}`} style={{ background: 'var(--team1)' }} title={r.speaking ? `${r.name} (falando)` : r.name}>
              {teams[1].symbol}
            </div>
          ))}
        </div>
      </div>
      {h.mode === 'correio' ? <ObjectiveHud /> : null}
      {spec ? null : <BuffChips />}
      <div className={`territory ${h.mode === 'correio' ? 'secondary' : ''}`} title="Território pintado agora (parcial)">
        <div style={{ width: `${h.territory[0]}%`, background: 'var(--team0)' }} />
        <div style={{ flex: 1 }} />
        <div style={{ width: `${h.territory[1]}%`, background: 'var(--team1)' }} />
      </div>
      <div className="status-tl">
        {conn !== 'connected' ? <span className="chip warn">{conn === 'reconnecting' ? 'Reconectando…' : 'Sem conexão'}</span> : <span className={`chip ${rtt !== null && rtt < 120 ? 'ok' : 'warn'}`}>{rtt ?? '–'} ms</span>}
        <VoiceChip compact />
      </div>

      {h.alive && !spec ? (
        <>
          <div className={`reticle ${low ? 'lowink' : ''}`} ref={refReticle} />
          <div className="hitmarker" ref={refHit} />
          <div className="blocked" ref={refBlocked} title="Obstáculo no caminho do disparo">
            ✕
          </div>
          <div className={`inktank ${low ? 'low' : ''}`} title={`Pigmento ${Math.round(h.ink)}%`}>
            <div style={{ height: `${h.ink}%`, background: inkColor }} />
            <div className="inkcost" style={{ bottom: `${MORINGA.inkCost}%`, opacity: 0.5 }} />
            <div className="inkcost" style={{ bottom: `${nextCost}%`, height: 1 }} />
          </div>
        </>
      ) : null}

      <div className="hud-bl" hidden={spec}>
        <div className={`gauge ${specialReady ? 'ready' : ''}`} title={RODA_DE_OLEIRO.name}>
          <svg viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="32" fill="rgba(20,14,12,.7)" stroke="rgba(255,244,230,.2)" strokeWidth="8" />
            <circle cx="40" cy="40" r="32" fill="none" stroke={specialReady ? 'var(--ouro)' : inkColor} strokeWidth="8" strokeDasharray={`${(h.special / 100) * circ} ${circ}`} transform="rotate(-90 40 40)" strokeLinecap="round" />
          </svg>
          <div className="label">
            {h.specialActive ? 'Roda\nativa' : specialReady ? `${hints.label('special')}\nRoda!` : `${Math.floor(h.special)}%`}
          </div>
        </div>
        <div className="equip">
          <strong>{w.name}</strong>
          <span className={h.secondaryReady ? '' : 'dim'}>
            <kbd>{hints.label('secondary')}</kbd> {MORINGA.name} ({MORINGA.inkCost}%)
          </span>
          <div className="healthbar" title="Resistência">
            <div style={{ width: `${h.hp}%`, background: h.hp < 40 ? 'var(--bad)' : 'var(--ok)' }} />
          </div>
          <span className="muted" style={{ fontSize: 11 }}>
            {h.form === 1 ? (h.submerged ? 'Forma Pião · imerso' : 'Forma Pião') : 'Forma Bibelô'}
          </span>
        </div>
      </div>

      <div className="killfeed" aria-live="polite">
        {h.killfeed.map((k) => (
          <div key={k.id} className={`k ${k.mine ? 'mine' : ''}`}>
            {k.killer ? <b style={{ color: `var(--team${k.killerTeam})` }}>{k.killer}</b> : null} {k.killer ? '→' : ''} <b style={{ color: `var(--team${k.victimTeam})` }}>{k.victim}</b> <span className="muted">({k.cause})</span>
          </div>
        ))}
      </div>

      <div className="state-flags" hidden={spec}>
        {h.inEnemyInk && h.alive ? <span className="chip bad">Tinta adversária: lento e exposto</span> : null}
        {low && h.alive ? <span className="chip warn">Pigmento baixo — recarregue na Forma Pião</span> : null}
        {h.protectedFor > 0 && h.alive ? <span className="chip ok">Proteção de reaparecimento</span> : null}
        {h.travelPhase === 1 ? <span className="chip warn">Preparando Pião-Guia…</span> : null}
        {h.denied ? <span className="chip bad">{h.denied}</span> : null}
      </div>

      <RoundIntro />
      {!h.alive && !spec && h.phase === 'running' ? (
        <div className="center-msg">
          <div className="sub">Voltando ao galpão em</div>
          <div className="big">{Math.max(0, h.respawnIn).toFixed(1)}</div>
        </div>
      ) : null}
      {h.phase === 'finishing' ? (
        <div className="center-msg">
          <div className="big">Fim!</div>
          <div className="sub">{result ? (h.mode === 'correio' ? 'Contando as entregas…' : 'Contando o território…') : ''}</div>
        </div>
      ) : null}
      {!spec && !locked && !menu && hints.device === 'teclado' && (h.phase === 'running' || h.phase === 'countdown') ? <div className="clicktoplay">Clique na arena para jogar · Esc abre o menu</div> : null}
      {!spec && specialReady && !h.specialActive && h.alive && h.phase === 'running' ? (
        <div className="special-hint" aria-live="polite">
          {pressText(hints.label('special'), hints.device)} para a {RODA_DE_OLEIRO.name}
        </div>
      ) : null}
    </div>
  );
}

const CAPSULE_TEXT: Record<string, string> = {
  aguardando: 'A cápsula já vai aparecer no centro',
  disponivel: 'Cápsula livre no centro',
  carregada: 'Cápsula em trânsito',
  caida: 'Cápsula caída',
  em_entrega: 'Entregando…',
  entregue: 'Entregue! Próxima estação anunciada',
  retornando: 'Cápsula voltando ao centro',
};

/** Correio do Ara: placar de entregas, estado da cápsula, direção da estação ativa e progresso. */
function ObjectiveHud() {
  const o = useStore(hudStore, (s) => s.objective);
  const myTeam = useStore(hudStore, (s) => s.myTeam);
  const teams = useTeams();
  const score = useRef<HTMLDivElement>(null);
  usePop(score, o ? o.deliveries[0] + o.deliveries[1] : 0, 0.6);
  if (!o) return null;
  const mine = o.carrier ? o.carrier.team === myTeam : false;
  const share = o.stationShare[myTeam];
  const ready = share >= CORREIO.stationPaintShare;
  const text = o.iCarry ? (ready ? 'Entre na estação e segure' : `Pinte a estação: ${Math.round(share * 100)}% de ${Math.round(CORREIO.stationPaintShare * 100)}%`) : o.carrier ? `${o.carrier.name} ${mine ? '(sua turma)' : '(adversário)'} está com a cápsula` : CAPSULE_TEXT[o.state];
  return (
    <div className={`objective ${o.iCarry ? 'carrying' : ''}`} role="status" aria-live="polite">
      <div className="obj-score" ref={score}>
        <b style={{ color: 'var(--team0)' }}>
          {teams[0].symbol} {o.deliveries[0]}
        </b>
        <span className="muted">
          entregas · {CORREIO.targetDeliveries} vencem
        </span>
        <b style={{ color: 'var(--team1)' }}>
          {o.deliveries[1]} {teams[1].symbol}
        </b>
      </div>
      <div className="obj-line">
        <span className="obj-arrow" style={{ transform: `rotate(${o.stationBearing}deg)` }} aria-label={`Estação a ${Math.round(o.stationDistance)} m`}>
          ▲
        </span>
        <span>
          Estação {Math.round(o.stationDistance)} m · {text}
          {o.state === 'caida' || o.state === 'retornando' ? ` (${Math.ceil(o.timer)} s)` : ''}
        </span>
      </div>
      {o.state === 'em_entrega' ? (
        <div className="obj-progress" aria-label="Progresso da entrega">
          <i style={{ width: `${Math.round(o.progress * 100)}%`, background: o.carrier ? `var(--team${o.carrier.team})` : 'var(--ouro)' }} />
        </div>
      ) : null}
    </div>
  );
}

/** Buff ativo (com tempo) e Mutirão (com recarga), à esquerda da mira, sem cobrir o centro. */
function BuffChips() {
  const buff = useStore(hudStore, (s) => s.buff);
  const left = useStore(hudStore, (s) => s.buffLeft);
  const mut = useStore(hudStore, (s) => s.mutirao);
  const cd = useStore(hudStore, (s) => s.mutiraoCooldown);
  const pop = useRef<HTMLSpanElement>(null);
  usePop(pop, mut > 0 ? 'on' : 'off', 1);
  const total = buff === 'embalo' ? BUFFS.embalo.duration : BUFFS.folego.duration;
  return (
    <div className="buffs" aria-live="polite">
      {buff ? (
        <span className={`buff ${buff}`} style={{ ['--p' as string]: String(Math.max(0, Math.min(1, left / total))) }}>
          {buff === 'embalo' ? '» Embalo' : '💧 Fôlego'} <small>{Math.ceil(left)} s</small>
        </span>
      ) : null}
      {mut > 0 ? (
        <span className="buff mutirao" ref={pop}>
          Mutirão! <small>{Math.ceil(mut)} s</small>
        </span>
      ) : cd > 0 && cd < MUTIRAO.cooldown - MUTIRAO.duration ? (
        <span className="buff idle" title="Recarga do Mutirão">
          Mutirão em {Math.ceil(cd)} s
        </span>
      ) : null}
    </div>
  );
}
