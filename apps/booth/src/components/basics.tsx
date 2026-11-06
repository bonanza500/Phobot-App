import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { iconSvg, robotSvg, posedRobotSvg, qrModulesSvg, type IconName, type RobotMood } from '@photobooth/ui';
import { useBooth } from '../store';

/** Raw SVG markup (prototype generators) rendered without a layout wrapper. */
export const Svg = memo(function Svg({ html, className, style }: { html: string; className?: string; style?: CSSProperties }) {
  return <span className={className} style={{ display: 'contents', ...style }} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** prototype IC(name, size, color) */
export function Icon({ n, z = 44, c = 'currentColor' }: { n: IconName; z?: number; c?: string }) {
  const html = useMemo(() => iconSvg(n, z, c), [n, z, c]);
  return <Svg html={html} />;
}

/** prototype R(mood, size) — memoized so the idle animation keeps its phase */
export function Robot({ m = 'hi', s = 240 }: { m?: RobotMood; s?: number }) {
  const html = useMemo(() => robotSvg(m, s), [m, s]);
  return <Svg html={html} />;
}

/** prototype RP(pose, size) */
export function PosedRobot({ pose, s = 250 }: { pose: string; s?: number }) {
  const html = useMemo(() => posedRobotSvg(pose, s), [pose, s]);
  return <Svg html={html} />;
}

const STEPS = ['Bayar', 'Foto', 'Edit', 'Simpan'];
/** Journey indicator shown top-right on every customer page. */
export function Steps({ cur }: { cur: number }) {
  const free = useBooth((s) => s.config?.pricing.firstPrint === 0);
  const steps = free ? ['Gratis', ...STEPS.slice(1)] : STEPS;
  return (
    <div className="pay-steps" aria-label={`Langkah ${cur + 1}: ${steps[cur]}`}>
      {steps.map((s, i) => (
        <span key={s} className={i === cur ? 'cur' : ''}>
          <i />
          {s}
        </span>
      ))}
    </div>
  );
}

/** Robot on the PayFree halo (dashed ring + dots), for centred status pages. */
export function HaloRobot({ m, s }: { m: RobotMood; s: number }) {
  return (
    <div className="booth-art" style={{ width: s * 1.3, height: s * 1.15 }}>
      <div className="free-halo" aria-hidden><i /><i /><i /></div>
      <Robot m={m} s={s} />
    </div>
  );
}

/** prototype bub(text, small) */
export function Bubble({ children, small, style }: { children: ReactNode; small?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="bub" style={style}>
      {children}
      {small ? <small>{small}</small> : null}
    </div>
  );
}

/** Real QR code drawn in the prototype QR style (ink modules, quiet margin). */
export const QrCode = memo(function QrCode({ text, size, level = 'M' }: { text: string; size: number; level?: 'L' | 'M' | 'Q' | 'H' }) {
  const html = useMemo(() => {
    try {
      const qr = QRCode.create(text, { errorCorrectionLevel: level });
      const n = qr.modules.size;
      const rows: boolean[][] = [];
      for (let y = 0; y < n; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < n; x++) row.push(!!qr.modules.data[y * n + x]);
        rows.push(row);
      }
      return qrModulesSvg(rows, size);
    } catch {
      return '';
    }
  }, [text, size, level]);
  return <Svg html={html} />;
});

/** A photo in the prototype `.ph` box (cover-fitted real image). */
export function Pic({ url, className = '', style, children }: { url?: string; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={`ph ${url ? '' : 'empty'} ${className}`} style={style}>
      {url ? <img className="pic" src={url} alt="" draggable={false} decoding="async" /> : null}
      {children}
    </div>
  );
}

export function Btn({
  children,
  className = '',
  onClick,
  disabled,
  busy,
  style,
  testId,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <button className={`btn ${className} ${busy ? 'wait' : ''}`} style={style} disabled={disabled} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}
