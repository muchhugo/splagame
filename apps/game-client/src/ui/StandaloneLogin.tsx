import { useState } from 'react';
import { DEV_USERS } from '../boot/host';
import { Logo } from './Logo';

/** Somente desenvolvimento: escolha um usuário de teste e a sessão (duas abas = dois jogadores). */
export function StandaloneLogin({ onSubmit }: { onSubmit: (userId: string, name: string, sid: string) => void }) {
  const [user, setUser] = useState(() => DEV_USERS[Math.floor(Math.random() * 4)].id);
  const [sid, setSid] = useState('sessao-dev-1');
  const valid = /^[a-z0-9-]{4,64}$/.test(sid);
  return (
    <div className="screen solid">
      <form
        className="panel dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const u = DEV_USERS.find((x) => x.id === user)!;
          onSubmit(u.id, u.name.replace(/ \(.*\)$/, ''), sid);
        }}
      >
        <Logo size={64} />
        <div className="devbanner">
          Modo laboratório (host de desenvolvimento no próprio jogo). Não é o Trivo: credenciais emitidas pelo backend de desenvolvimento local.
        </div>
        <label className="field">
          Usuário de teste
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            {DEV_USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Sessão da Atividade (use a mesma em duas abas para jogar junto)
          <input value={sid} onChange={(e) => setSid(e.target.value.toLowerCase())} maxLength={64} aria-invalid={!valid} />
        </label>
        <div className="row">
          <button className="btn primary" type="submit" disabled={!valid} autoFocus>
            Entrar no Pátio
          </button>
        </div>
      </form>
    </div>
  );
}
