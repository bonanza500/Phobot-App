import { useRef, useState } from 'react';
import { useBooth } from '../store';
import { Icon, Robot } from '../components/basics';
import { puffs } from '../robot/floating';
import { startSession } from '../flow';
import { requestFullscreen } from '../kiosk';

/** prototype V.welcome + ninja(): the robot itself is the start button */
export function Welcome() {
  const wr = useRef<HTMLDivElement>(null);
  const [vanish, setVanish] = useState(false);
  const branding = useBooth((s) => s.config?.branding);
  const angles = useBooth((s) => s.config?.session.angles ?? 10);
  const chip = (branding?.welcomeChip ?? 'Studio foto otomatis · 10 angle').replace(/\b\d+ (sudut|angle)\b/i, `${angles} angle`);

  const ninja = () => {
    if (vanish) return;
    void requestFullscreen();
    setVanish(true);
    puffs(wr.current, 620, 650, 9);
    setTimeout(() => puffs(wr.current, 620, 650, 6), 350);
    void startSession();
  };

  return (
    <div className="scr en" style={{ justifyContent: 'center', paddingLeft: 150 }}>
      <svg style={{ position: 'absolute', right: -140, top: 40 }} width="1000" height="1000" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48" fill="var(--lv)" />
        <circle cx="50" cy="50" r="34" fill="var(--pk)" />
        <circle cx="50" cy="50" r="20" fill="var(--pe)" />
      </svg>
      <div
        id="wr"
        ref={wr}
        className={vanish ? 'wel-bot go' : 'wel-bot'}
        role="button"
        tabIndex={0}
        aria-label="Sentuh robot untuk mulai"
        aria-disabled={vanish}
        data-testid="start"
        onClick={ninja}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            ninja();
          }
        }}
      >
        <i className="wel-ring" />
        <i className="wel-ring" />
        <i className="wel-ring" />
        <div className="wel-press">
          <div id="wri" className={vanish ? 'vanish' : ''}>
            <Robot m="hi" s={620} />
          </div>
        </div>
        <div className="wel-bubble">
          <div>Sentuh aku!</div>
        </div>
      </div>
      <div style={{ position: 'relative', maxWidth: 1000 }}>
        <div className="chip b" style={{ marginBottom: 40, fontWeight: 500 }}>
          {chip}
        </div>
        <h1>
          Robot
          <br />
          Photobooth
        </h1>
        <div style={{ marginTop: 56, display: 'flex', alignItems: 'center', gap: 20 }}>
          <p style={{ margin: 0, fontSize: 50, fontWeight: 400, lineHeight: 1.15, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
            Sentuh robot
            <br />
            untuk mulai foto
          </p>
          <div className="wel-arrows" aria-hidden="true">
            <Icon n="next" z={84} c="var(--bl)" />
            <Icon n="next" z={84} c="var(--bl)" />
            <Icon n="next" z={84} c="var(--bl)" />
          </div>
        </div>
      </div>
    </div>
  );
}
