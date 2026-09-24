import { useStore } from '../app/store';
import { uiStore } from '../app/uiStore';

export function Notices() {
  const notices = useStore(uiStore, (s) => s.notices);
  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.kind}`}>
          {n.text}
        </div>
      ))}
    </div>
  );
}
