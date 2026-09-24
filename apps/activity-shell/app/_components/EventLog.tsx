'use client';

export type LogLevel = 'info' | 'warn' | 'error' | 'activity';

export interface LogLine {
  id: number;
  time: string;
  level: LogLevel;
  text: string;
}

const LEVEL_LABEL: Record<LogLevel, string> = { info: 'host', warn: 'aviso', error: 'erro', activity: 'atividade' };

/** Registro de eventos (mais recente primeiro; no máximo 100 linhas). */
export function EventLog(props: { lines: LogLine[]; onClear(): void }) {
  return (
    <section className="panel log" aria-label="Registro de eventos">
      <div className="log-head">
        <h2>Eventos</h2>
        <span className="muted">{props.lines.length}/100</span>
        <button type="button" onClick={props.onClear} disabled={props.lines.length === 0}>
          Limpar
        </button>
      </div>
      <ol className="log-lines">
        {props.lines
          .slice()
          .reverse()
          .map((l) => (
            <li key={l.id} className={`lvl-${l.level}`}>
              <time>{l.time}</time>
              <span className="lvl">{LEVEL_LABEL[l.level]}</span>
              <span className="txt">{l.text}</span>
            </li>
          ))}
      </ol>
    </section>
  );
}
