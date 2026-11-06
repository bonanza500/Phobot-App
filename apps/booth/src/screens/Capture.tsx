import type { ReactNode } from 'react';
import { nextMissingStep, p2, sessionTip, SNAP_WORDS, TIP_CATEGORY_COLORS, type TipCategory } from '@photobooth/shared';
import { currentTemplate, slotRatio, useBooth } from '../store';
import { Cam, LiveChip } from '../components/Cam';
import { Icon } from '../components/basics';
import { skipSession } from '../flow';

/** Shared capture layout: camera left; robot dock, pose card and countdown ring in the right column. */
function Studio({ head, angles, at, retake, cam, children }: { head: ReactNode; angles: number; at: number; retake?: boolean; cam: ReactNode; children: ReactNode }) {
  return (
    <div className="scr en booth-theme">
      <div className="studio-top">
        {head}
        <div className="studio-segs" aria-hidden>
          {[...Array(angles)].map((_, i) => (
            <i key={i} className={i === at ? 'cur' : i < at || retake ? 'on' : ''} />
          ))}
        </div>
        <LiveChip />
      </div>
      <div className="studio-main">
        {cam}
        <aside className="studio-side">
          {/* the floating robot parks here (robot/floating.ts dock()) */}
          <div className="studio-dock" data-dock />
          {children}
        </aside>
      </div>
    </div>
  );
}

function PoseCard({ cat, title, desc, className = '', testId }: { cat?: TipCategory | null; title: string; desc?: string; className?: string; testId?: string }) {
  return (
    <div className={`studio-pose tip ${className}`} data-testid={testId} aria-live="polite">
      {cat ? <span className="studio-cat" style={{ background: TIP_CATEGORY_COLORS[cat] }}>{cat}</span> : null}
      <strong>{title}</strong>
      {desc ? <small>{desc}</small> : null}
    </div>
  );
}

const C = 2 * Math.PI * 88;
/** One ring for every phase: fill 0..1, tone (pk/ok), anim (spin/drain), k remounts the arc and pops the content. */
function Ring({ fill = 0, tone = '', anim = '', k, label, children, testId }: { fill?: number; tone?: string; anim?: string; k?: string | number; label: string; children?: ReactNode; testId?: string }) {
  return (
    <div className={`studio-ring ${tone}`} data-testid={testId}>
      <div className="studio-dial">
        <svg viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="88" />
          <circle cx="100" cy="100" r="88" key={anim ? k : undefined} className={anim} style={{ strokeDashoffset: C * (1 - fill) }} />
        </svg>
        <b key={k}>{children}</b>
      </div>
      <span>{label}</span>
    </div>
  );
}

/** prototype V.ready */
export function Ready() {
  const cd = useBooth((s) => s.readyCd);
  const session = useBooth((s) => s.session)!;
  const total = useBooth((s) => s.readyTotal);
  const { angles, shotsPerAngle } = session.plan;
  const next = nextMissingStep(session.photos, angles, shotsPerAngle);
  const angle = next?.angle ?? 0;
  const pct = total > 1 ? (total - cd) / (total - 1) : 1;
  const ratio = useBooth(slotRatio);
  const tip = sessionTip(session.id, angle, 0, shotsPerAngle);
  return (
    <Studio head={<b className="studio-label">ANGLE {p2(angle + 1)} · SEGERA DIMULAI</b>} angles={angles} at={angle} cam={<Cam style={{ flex: 1 }} ratio={ratio} />}>
      <PoseCard cat={tip[0]} title={tip[1]} desc={tip[2]} />
      <Ring fill={Math.max(0, Math.min(1, pct))} tone="pk" k={cd} label="Mulai dalam" testId="ready-cd">
        {cd}
      </Ring>
      <p className="studio-note">Cari posisi nyaman dan jaga jarak dari robot.</p>
    </Studio>
  );
}

/** Pose shown by the floating robot during the session (prototype sesPose()). */
export function sessionPose(phase: string, angle: number, shot: number, shotsPerAngle: number, seed = ''): string {
  if (phase === 'move') return 'cam';
  if (phase === 'nice') return 'cheer';
  return sessionTip(seed, angle, Math.max(shot, 1) - 1, shotsPerAngle)[3];
}

/** prototype V.session */
export function Session() {
  const session = useBooth((s) => s.session)!;
  const c = useBooth((s) => s.capture);
  const { angles, shotsPerAngle } = session.plan;
  const retake = session.status === 'RETAKE' || session.capture.retakeAngle !== null;
  const a = c.angle;
  const tip = sessionTip(session.id, a, Math.max(c.shot, 1) - 1, shotsPerAngle);
  const snap = SNAP_WORDS[tip[3]] ?? 'Jepret!';
  const posing = c.phase === 'prep' || c.phase === 'cd';
  const [cat, title, desc]: readonly [TipCategory | null, string, string] = posing
    ? [tip[0], tip[1], tip[2]]
    : c.phase === 'nice'
      ? [null, c.message, '']
      : [null, `Pindah ke Angle ${p2(a + 1)}`, retake ? 'Robot bersiap untuk mengulang angle ini.' : 'Robot sedang mencari angle terbaik.'];
  // prepEnd is refreshed on every poll, so this re-renders often enough for whole seconds.
  const left = c.prepEnd ? Math.max(0, Math.ceil((c.prepEnd - Date.now()) / 1000)) : 0;
  const ratio = useBooth(slotRatio);
  const need = useBooth((s) => currentTemplate(s).photoCount);
  // Enough photos for the frame's slots → may stop early. Hidden mid-shot so the shot in flight isn't cut.
  const canFinish = !retake && a < angles - 1 && session.photos.filter((photo) => photo.selected && !photo.superseded).length >= need && c.phase !== 'cd';
  return (
    <Studio
      head={
        <b className="studio-label" data-testid="session-angle">
          {retake ? 'ULANG · ' : ''}ANGLE {p2(a + 1)} / {p2(angles)}
        </b>
      }
      angles={angles}
      at={a}
      retake={retake}
      cam={
        <Cam style={{ flex: 1, position: 'relative' }} ratio={ratio}>
          <div className={`fl ${c.flashKey ? 'go' : ''}`} key={`fl${c.flashKey ?? 0}`} id="fl" />
        </Cam>
      }
    >
      <PoseCard cat={cat} title={title} desc={desc} className={retake ? 'retake' : ''} testId="session-stat" key={`${posing ? 'pose' : c.phase}-${a}`} />
      {c.phase === 'cd' && c.cd === 'snap' ? (
        <Ring fill={0.25} tone="pk" anim="spin" k={`s${c.cdKey}`} label="Menyimpan…">
          <span className={`studio-snap ${snap.length > 7 ? 'long' : ''}`}>{snap}</span>
        </Ring>
      ) : c.phase === 'cd' && typeof c.cd === 'number' ? (
        <Ring fill={1} tone="pk" anim="drain" k={c.cdKey} label="Tahan posenya">
          {c.cd}
        </Ring>
      ) : c.phase === 'nice' ? (
        <Ring fill={1} tone="ok" label="Tersimpan">
          <Icon n="check" z={88} />
        </Ring>
      ) : c.phase === 'prep' ? (
        <Ring fill={0.25} tone="pk" anim="spin" label="Siap-siap">
          {left || <Icon n="clock" z={72} />}
        </Ring>
      ) : (
        <Ring fill={0.25} anim="spin" label="Pindah angle">
          <Icon n="cam" z={72} />
        </Ring>
      )}
      {canFinish ? (
        <button className="btn studio-done" onClick={skipSession} data-testid="session-finish">
          <Icon n="check" z={30} /> Selesai
        </button>
      ) : null}
    </Studio>
  );
}
