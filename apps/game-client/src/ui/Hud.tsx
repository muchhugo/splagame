import { useEffect, useRef } from 'react';
import { INK, MORINGA, RODA_DE_OLEIRO, WEAPONS } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { hudDom, hudStore } from '../game/hud';
import { pressText, useHints } from '../app/hints';
import { useTeams } from '../app/teams';
import { VoiceChip } from './VoiceChip';

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
  const hints = useHints();
  const teams = useTeams();
  const reticle = useRef<HTMLDivElement>(null);
  const blocked = useRef<HTMLDivElement>(null);
  const hit = useRef<HTMLDivElement>(null);
  const dmg = useRef<HTMLDivElement>(null);
  const plates = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hudDom.reticle = reticle.current;
    hudDom.blocked = blocked.current;
    hudDom.nameplates = plates.current;
    hudDom.hitmarker = hit.current;
    hudDom.damage = dmg.current;
    return () => {
      hudDom.reticle = hudDom.blocked = hudDom.hitmarker = hudDom.damage = hudDom.nameplates = null;
    };
  }, []);
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
      <div className="damage-vignette" ref={dmg} />
      <div className="nameplates" ref={plates} aria-hidden="true" />
      <div className="hud-top">
        <div className="roster" aria-label={`Turma ${teams[0].name}`}>
          {t0.map((r) => (
            <div key={r.playerId} data-player={r.playerId} data-speaking={r.speaking ? 'true' : 'false'} className={`dot ${r.alive ? '' : 'dead'} ${r.isMe ? 'me' : ''} ${r.specialReady ? 'ready' : ''} ${r.speaking ? 'speaking' : ''}`} style={{ background: 'var(--team0)' }} title={r.speaking ? `${r.name} (falando)` : r.name}>
              {teams[0].symbol}
            </div>
          ))}
        </div>
        <div className={`timer ${urgent ? 'urgent' : ''}`} aria-label="Tempo restante">
          {h.phase === 'countdown' ? '3:00' : fmtTime(h.timeLeftMs)}
        </div>
        <div className="roster" aria-label={`Turma ${teams[1].name}`}>
          {t1.map((r) => (
            <div key={r.playerId} data-player={r.playerId} data-speaking={r.speaking ? 'true' : 'false'} className={`dot ${r.alive ? '' : 'dead'} ${r.isMe ? 'me' : ''} ${r.specialReady ? 'ready' : ''} ${r.speaking ? 'speaking' : ''}`} style={{ background: 'var(--team1)' }} title={r.speaking ? `${r.name} (falando)` : r.name}>
              {teams[1].symbol}
            </div>
          ))}
        </div>
      </div>
      <div className="territory" title="Território pintado agora (parcial)">
        <div style={{ width: `${h.territory[0]}%`, background: 'var(--team0)' }} />
        <div style={{ flex: 1 }} />
        <div style={{ width: `${h.territory[1]}%`, background: 'var(--team1)' }} />
      </div>
      <div className="status-tl">
        {conn !== 'connected' ? <span className="chip warn">{conn === 'reconnecting' ? 'Reconectando…' : 'Sem conexão'}</span> : <span className={`chip ${rtt !== null && rtt < 120 ? 'ok' : 'warn'}`}>{rtt ?? '–'} ms</span>}
        <VoiceChip />
      </div>

      {h.alive ? (
        <>
          <div className={`reticle ${low ? 'lowink' : ''}`} ref={reticle} />
          <div className="hitmarker" ref={hit} />
          <div className="blocked" ref={blocked} title="Obstáculo no caminho do disparo">
            ✕
          </div>
          <div className={`inktank ${low ? 'low' : ''}`} title={`Pigmento ${Math.round(h.ink)}%`}>
            <div style={{ height: `${h.ink}%`, background: inkColor }} />
            <div className="inkcost" style={{ bottom: `${MORINGA.inkCost}%`, opacity: 0.5 }} />
            <div className="inkcost" style={{ bottom: `${nextCost}%`, height: 1 }} />
          </div>
        </>
      ) : null}

      <div className="hud-bl">
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

      <div className="state-flags">
        {h.inEnemyInk && h.alive ? <span className="chip bad">Tinta adversária: lento e exposto</span> : null}
        {low && h.alive ? <span className="chip warn">Pigmento baixo — recarregue na Forma Pião</span> : null}
        {h.protectedFor > 0 && h.alive ? <span className="chip ok">Proteção de reaparecimento</span> : null}
        {h.travelPhase === 1 ? <span className="chip warn">Preparando Pião-Guia…</span> : null}
        {h.denied ? <span className="chip bad">{h.denied}</span> : null}
      </div>

      {h.phase === 'countdown' ? (
        <div className="center-msg">
          <div className="big" key={Math.ceil(h.timeLeftMs / 1000)}>
            {Math.max(1, Math.ceil(h.timeLeftMs / 1000))}
          </div>
          <div className="sub">Pinte o chão! Vence quem cobrir mais área.</div>
        </div>
      ) : null}
      {!h.alive && h.phase === 'running' ? (
        <div className="center-msg">
          <div className="sub">Voltando ao galpão em</div>
          <div className="big">{Math.max(0, h.respawnIn).toFixed(1)}</div>
        </div>
      ) : null}
      {h.phase === 'finishing' ? (
        <div className="center-msg">
          <div className="big">Fim!</div>
          <div className="sub">{result ? 'Contando o território…' : ''}</div>
        </div>
      ) : null}
      {!locked && !menu && hints.device === 'teclado' && (h.phase === 'running' || h.phase === 'countdown') ? <div className="clicktoplay">Clique na arena para jogar · Esc abre o menu</div> : null}
      {specialReady && !h.specialActive && h.alive && h.phase === 'running' ? (
        <div className="special-hint" aria-live="polite">
          {pressText(hints.label('special'), hints.device)} para a {RODA_DE_OLEIRO.name}
        </div>
      ) : null}
    </div>
  );
}
