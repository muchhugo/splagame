import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { getController } from './App';

/**
 * Estado real da voz informado pelo host. Nada é simulado. `compact` (HUD da partida)
 * usa textos curtos para não disputar espaço com o placar em telas baixas.
 */
export function VoiceChip({ compact = false }: { compact?: boolean }) {
  const v = useStore(uiStore, (s) => s.voice);
  if (!v.available)
    return (
      <span className="chip" title="O host não tem voz configurada neste ambiente">
        {compact ? 'Sem voz' : 'Voz não configurada neste ambiente'}
      </span>
    );
  if (!v.connected) return <span className="chip warn">{v.reason === 'connecting' ? 'Voz conectando…' : 'Fora da chamada'}</span>;
  const speaking = v.participants.filter((p) => p.speaking).map((p) => p.displayName);
  return (
    <button className={`chip ${v.muted ? '' : 'ok'}`} style={{ border: 0, color: 'inherit' }} onClick={() => void getController()?.toggleMute()} title="Voz compartilhada da chamada: todas as turmas se ouvem.">
      {v.muted ? 'Microfone mudo' : 'Microfone aberto'} · {v.participants.length}
      {compact ? '' : ' na chamada'}
      {speaking.length && !compact ? ` · falando: ${speaking.join(', ')}` : ''}
    </button>
  );
}
