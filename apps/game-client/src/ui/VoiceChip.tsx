import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';
import { getController } from './App';

/** Estado real da voz informado pelo host. Nada é simulado. */
export function VoiceChip() {
  const v = useStore(uiStore, (s) => s.voice);
  if (!v.available) return <span className="chip" title="O host não tem voz configurada">Voz não configurada neste ambiente</span>;
  if (!v.connected) return <span className="chip warn">{v.reason === 'connecting' ? 'Voz conectando…' : 'Fora da chamada'}</span>;
  const speaking = v.participants.filter((p) => p.speaking).map((p) => p.displayName);
  return (
    <button className={`chip ${v.muted ? '' : 'ok'}`} style={{ border: 0, color: 'inherit' }} onClick={() => void getController()?.toggleMute()} title="Voz compartilhada da chamada: todas as turmas se ouvem.">
      {v.muted ? 'Microfone mudo' : 'Microfone aberto'} · {v.participants.length} na chamada{speaking.length ? ` · falando: ${speaking.join(', ')}` : ''}
    </button>
  );
}
