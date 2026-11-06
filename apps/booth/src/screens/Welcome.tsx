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
      <div
        className="scr en booth-theme booth-welcome"
        style={{ justifyContent: 'center', paddingLeft: 150, paddingBottom: 90, cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        aria-label="Sentuh layar untuk mulai"
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
      <div className="free-spark free-spark-one" aria-hidden="true">✦</div>
      <div className="free-spark free-spark-two" aria-hidden="true">✧</div>
      <div className="wel-art" aria-hidden="true">
        <div className="free-halo"><i /><i /><i /></div>
        <div className="free-confetti confetti-a">✦</div>
        <div className="free-confetti confetti-b">✧</div>
        <div className="free-confetti confetti-c">●</div>
        <div className="free-confetti confetti-d">✦</div>
      </div>
      <div
        id="wr"
        ref={wr}
        className={vanish ? 'wel-bot go' : 'wel-bot'}
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
          <div>Sentuh layar!</div>
        </div>
      </div>
      <div style={{ position: 'relative', maxWidth: 1000 }}>
        <div className="free-eyebrow"><span>✦</span> {chip} <span>✦</span></div>
        <h1>
          Robot
          <br />
          <em>Photobooth</em>
        </h1>
        <div className="wel-cta">
          <p>
            Sentuh layar
            <br />
            untuk mulai foto
          </p>
          <div className="wel-arrows" aria-hidden="true">
            <Icon n="next" z={56} />
            <Icon n="next" z={56} />
            <Icon n="next" z={56} />
          </div>
        </div>
      </div>
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> FOTO · EDIT · CETAK · QR</footer>
    </div>
  );
}
