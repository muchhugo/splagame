import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import type { TeamId } from '@borrifo/game-contracts';
import { CORREIO, MODES } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { hudStore } from '../game/hud';
import { useTeams } from '../app/teams';
import { Avatar } from './Avatar';
import { ModeIcon } from './icons';
import { motionAllowed } from './motion';
import { VARIANT_NAME } from './Lobby';

/**
 * Entrada na rodada, em cima do sobrevoo da câmera: cartaz do lugar enquanto carrega,
 * as duas turmas frente a frente no começo da contagem, o número grande e, na largada,
 * o "VALENDO!" com respingo próprio. Não bloqueia nada: é sobreposição sem clique.
 */
export function RoundIntro() {
  const phase = useStore(hudStore, (s) => s.phase);
  const left = useStore(hudStore, (s) => s.timeLeftMs);
  const myTeam = useStore(hudStore, (s) => s.myTeam);
  const mode = useStore(hudStore, (s) => s.mode);
  const spectating = useStore(hudStore, (s) => s.spectating);
  const lobby = useStore(uiStore, (s) => s.lobby);
  const teams = useTeams();
  const [goUntil, setGoUntil] = useState(0);
  const [, tick] = useState(0);
  const prev = useRef(phase);
  useEffect(() => {
    if (phase === 'running' && prev.current === 'countdown') setGoUntil(performance.now() + 1300);
    prev.current = phase;
  }, [phase]);
  useEffect(() => {
    if (!goUntil) return;
    const t = setTimeout(() => {
      setGoUntil(0);
      tick((x) => x + 1);
    }, Math.max(0, goUntil - performance.now()));
    return () => clearTimeout(t);
  }, [goUntil]);

  const n = Math.max(1, Math.ceil(left / 1000));
  const showMap = phase === 'loading' || (phase === 'countdown' && n >= 3);
  const showTeams = phase === 'countdown' && n >= 2;
  const go = goUntil > 0 && phase === 'running';
  if (!lobby || (!showMap && !showTeams && phase !== 'countdown' && !go)) return null;
  const other: TeamId = myTeam === 0 ? 1 : 0;
  const inRound = lobby.players.filter((p) => p.inRound);
  const sub = mode === 'correio' ? `Leve a cápsula à estação. ${CORREIO.targetDeliveries} entregas vencem.` : 'Pinte o chão! Vence quem cobrir mais área.';
  return (
    <div className="round-intro" aria-live="polite">
      {showMap ? (
        <div className="ri-map">
          <span className="ri-mode">
            <ModeIcon mode={mode} size={30} />
            {MODES[mode].name}
          </span>
          <span className="ri-name">{lobby.map.name}</span>
          <span className="ri-var">variante {VARIANT_NAME[lobby.map.variant]}</span>
        </div>
      ) : null}
      {showTeams ? (
        <div className="ri-teams">
          {([myTeam, other] as TeamId[]).map((t, i) => {
            const people = inRound.filter((p) => p.team === t);
            return (
              <div key={t} className={`ri-team t${t} ${i === 0 ? 'mine' : 'theirs'}`}>
                <span className="ri-tname">
                  {teams[t].symbol} Turma {teams[t].name}
                </span>
                <span className="ri-faces">
                  {people.slice(0, 6).map((p) => (
                    <Avatar key={p.playerId} player={p} size={30} />
                  ))}
                  {people.length > 6 ? <em>+{people.length - 6}</em> : null}
                </span>
              </div>
            );
          })}
          <span className="ri-vs" aria-hidden="true">
            ×
          </span>
        </div>
      ) : null}
      {phase === 'countdown' ? (
        <>
          <Count n={n} />
          <div className="ri-sub">{sub}</div>
        </>
      ) : null}
      {go ? <GoSplash team={spectating ? null : myTeam} /> : null}
    </div>
  );
}

function Count({ n }: { n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { scale: 2.2, rotate: -12, opacity: 0 }, { scale: 1, rotate: -4, opacity: 1, duration: 0.42, ease: 'back.out(2.4)' });
    }, el);
    return () => ctx.revert();
  }, [n]);
  return (
    <div className="ri-count" ref={ref} key={n}>
      {n}
    </div>
  );
}

/** Largada: respingo desenhado aqui (forma própria) na cor da sua turma e a palavra da largada. */
function GoSplash({ team }: { team: TeamId | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.go-blob', { scale: 0.2, rotate: -40 }, { scale: 1, rotate: 0, duration: 0.45, ease: 'back.out(2)' });
      gsap.fromTo('.go-word', { scale: 2.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, delay: 0.08, ease: 'back.out(2.6)' });
      gsap.fromTo('.go-drop', { scale: 0 }, { scale: 1, duration: 0.3, stagger: 0.04, delay: 0.12, ease: 'back.out(3)' });
      gsap.to(el, { opacity: 0, scale: 1.08, duration: 0.3, delay: 0.95 });
    }, el);
    return () => ctx.revert();
  }, []);
  return (
    <div className="go-splash" ref={ref} style={{ ['--go' as string]: team === null ? 'var(--ouro)' : `var(--team${team})` }}>
      <svg viewBox="0 0 400 260" className="go-blob" aria-hidden="true">
        <path
          d="M200 18c30 0 42 26 64 22s44-20 60 0-4 40 12 56 50 10 50 38-38 26-44 46 22 46-6 58-44-14-66-4-30 30-62 26-30-34-56-36-54 22-72 2 12-40-6-58-58-10-58-38 42-30 46-50-18-44 8-58 44 12 62 4 38-34 68-34z"
          fill="var(--go)"
          stroke="#1d1411"
          strokeWidth="8"
          strokeLinejoin="round"
        />
      </svg>
      {[
        [8, 22, 20],
        [88, 14, 14],
        [4, 78, 16],
        [94, 70, 22],
        [50, 94, 12],
      ].map(([x, y, s], i) => (
        <i key={i} className="go-drop" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s }} />
      ))}
      <span className="go-word">Valendo!</span>
    </div>
  );
}
