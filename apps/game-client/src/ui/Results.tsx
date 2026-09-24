import { WEAPONS } from '@borrifo/game-content';
import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { useTeams } from '../app/teams';
import { getController } from './App';
import { Logo } from './Logo';

export function Results() {
  const r = useStore(uiStore, (s) => s.result ?? s.lobby?.lastResult ?? null);
  const lobby = useStore(uiStore, (s) => s.lobby);
  const welcome = useStore(uiStore, (s) => s.welcome);
  const teams = useTeams();
  if (!r || !lobby || !welcome) return null;
  const c = getController();
  const myId = welcome.playerId;
  const me = r.players.find((p) => p.playerId === myId);
  const isHost = lobby.hostPlayerId === myId;
  const votes = new Set(lobby.rematchVotes);
  const title = r.winner === 'draw' ? 'Empate!' : `Vitória da Turma ${teams[r.winner].name}`;
  const mine = r.winner !== 'draw' && me ? (me.team === r.winner ? 'Sua turma venceu!' : 'Não foi desta vez.') : '';
  const humans = lobby.players.filter((p) => !p.isBot && p.connection === 'connected');
  const secs = lobby.phaseRemainingMs !== null ? Math.ceil(lobby.phaseRemainingMs / 1000) : null;
  return (
    <div className="screen">
      <div className="results panel" role="dialog" aria-labelledby="res-title">
        <Logo size={40} />
        <h1 id="res-title" className="winner" style={{ color: r.winner === 'draw' ? 'var(--creme)' : `var(--team${r.winner})` }}>
          {title}
        </h1>
        {mine ? <div style={{ textAlign: 'center' }}>{mine}</div> : null}
        {r.status === 'interrupted' ? <div className="chip warn">Rodada interrompida — sem vencedor oficial</div> : null}
        <div className="bigbar" aria-label="Território final">
          <div style={{ width: `${r.percent[0]}%`, background: 'var(--team0)' }}>
            {teams[0].symbol} {r.percent[0].toFixed(1)}%
          </div>
          <div style={{ width: `${r.neutralPercent}%`, background: 'rgba(255,244,230,.18)' }}>neutro {r.neutralPercent.toFixed(1)}%</div>
          <div style={{ width: `${r.percent[1]}%`, background: 'var(--team1)' }}>
            {teams[1].symbol} {r.percent[1].toFixed(1)}%
          </div>
        </div>
        <div className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
          Área pontuável: {r.totalArea.toFixed(0)} m² · Urucum {r.teamArea[0].toFixed(1)} m² · Anil {r.teamArea[1].toFixed(1)} m² · neutro {r.neutralArea.toFixed(1)} m²
        </div>
        <table className="stats">
          <thead>
            <tr>
              <th>Participante</th>
              <th>Ferramenta</th>
              <th>Área conquistada</th>
              <th>Eliminações</th>
              <th>Retornos</th>
              <th>Rodas</th>
            </tr>
          </thead>
          <tbody>
            {[...r.players]
              .sort((a, b) => a.team - b.team || b.paintedArea - a.paintedArea)
              .map((p) => (
                <tr key={p.playerId} style={p.playerId === myId ? { outline: '2px solid var(--ouro)' } : undefined}>
                  <td style={{ color: `var(--team${p.team})`, fontWeight: 700 }}>
                    {teams[p.team].symbol} {p.displayName}
                    {p.isBot ? ' · bot' : ''}
                    {votes.has(p.playerId) && !p.isBot ? ' ✓' : ''}
                  </td>
                  <td>{WEAPONS[p.weaponId].name}</td>
                  <td>{p.paintedArea.toFixed(1)} m²</td>
                  <td>{p.eliminations}</td>
                  <td>{p.deaths}</td>
                  <td>{p.specialsUsed}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => c?.vote('rematch')} disabled={votes.has(myId)} autoFocus>
            {votes.has(myId) ? `Aguardando revanche (${[...votes].filter((v) => humans.some((h) => h.playerId === v)).length}/${humans.length})` : 'Revanche'}
          </button>
          {isHost ? (
            <button className="btn ghost" data-sfx="back" onClick={() => c?.vote('lobby')}>
              Voltar ao lobby
            </button>
          ) : null}
          <button className="btn ghost" data-sfx="back" onClick={() => void c?.close('user')}>
            Sair da Atividade
          </button>
        </div>
        {secs !== null && lobby.phase === 'results' ? <div className="muted" style={{ textAlign: 'center', fontSize: 12 }}>Volta ao lobby automaticamente em {secs}s</div> : null}
      </div>
    </div>
  );
}
