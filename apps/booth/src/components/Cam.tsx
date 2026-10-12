import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useBooth } from '../store';
import { cameraInstance } from '../camera/service';

/**
 * Polls single JPEG frames (glambot GET /api/robot/liveview) into a canvas.
 * Per-frame requests survive the camera being busy while shooting: a failed
 * frame is skipped and the last good one stays on screen.
 */
function useJpegPollCanvas(url: string | null | undefined, ref: { current: HTMLCanvasElement | null }) {
  useEffect(() => {
    if (!url) return;
    let stop = false;
    let n = 0;
    const next = (ms: number) => !stop && setTimeout(load, ms);
    const load = () => {
      const img = new Image();
      img.onload = () => {
        const c = ref.current;
        // freeze: keep the "Jepret!" frame on screen until the real photo replaces it.
        if (c && !useBooth.getState().capture.freeze) {
          if (c.width !== img.naturalWidth || c.height !== img.naturalHeight) Object.assign(c, { width: img.naturalWidth, height: img.naturalHeight });
          c.getContext('2d')?.drawImage(img, 0, 0);
        }
        next(80);
      };
      img.onerror = () => next(700);
      img.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}_${++n}`;
    };
    load();
    return () => {
      stop = true;
    };
  }, [url, ref]);
}

const delay = (w: number) => `-${((Date.now() / 1000) % w).toFixed(2)}s`;

/**
 * prototype cam(): the camera container (corner frame, LIVE badge, countdown,
 * flash, status pill). Production: shows the REAL live view —
 *  - webcam: <video> from getUserMedia
 *  - DSLR via server driver: MJPEG <img>
 *  - mock camera: the prototype's animated gradient + silhouette placeholder
 * Fit (cover/contain), mirror and rotation come from configuration; the aspect
 * ratio is never distorted.
 */
export function Cam({ children, style, ratio }: { children?: ReactNode; style?: CSSProperties; ratio?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => setAvail((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!ratio]);
  if (!ratio) return <CamBox style={style}>{children}</CamBox>;
  // Box (inside the 10px .cam border) matches the saved photo; the frame-slot area is cut out of a dim layer.
  const B = 20;
  const cw = Math.max(0, Math.min(avail.w - B, (avail.h - B) * PHOTO_RATIO));
  const ch = cw / PHOTO_RATIO;
  return (
    <div ref={outer} style={{ ...style, minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {avail.w > 0 && (
        <CamBox style={{ width: cw + B, height: ch + B, flex: 'none' }} hole={ratio}>
          {children}
        </CamBox>
      )}
    </div>
  );
}

// ponytail: Canon EOS R100 saves 6000×3368 (16:9). Change if the camera's aspect setting changes.
const PHOTO_RATIO = 16 / 9;

/** Darkens what falls outside the frame slot; the centre crop is what the frame keeps. */
function SlotMask({ w, h, ratio }: { w: number; h: number; ratio: number }) {
  if (!w || !h) return null;
  const hw = Math.min(w, h * ratio);
  const hh = hw / ratio;
  return (
    <div className="slot-mask" aria-hidden>
      <i className="slot-hole" style={{ left: (w - hw) / 2, top: (h - hh) / 2, width: hw, height: hh }} />
    </div>
  );
}

function CamBox({ children, style, hole }: { children?: ReactNode; style?: CSSProperties; hole?: number }) {
  const cfg = useBooth((s) => s.config?.camera);
  const camState = useBooth((s) => s.cameraState);
  const shotUrl = useBooth((s) => s.capture.shotUrl);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [delays] = useState(() => ({ d20: delay(20), d9: delay(9) }));

  const mode = cfg?.mode ?? 'mock';
  const live = mode === 'browser' ? ['ready', 'previewing', 'capturing'].includes(camState) : true;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (mode !== 'browser') return;
    const cam = cameraInstance();
    cam?.attachVideo(videoRef.current);
    void cam?.start().catch(() => undefined);
    return () => cam?.attachVideo(null);
  }, [mode]);

  useJpegPollCanvas(mode === 'server' ? cfg?.liveViewUrl : null, canvasRef);

  const rot = cfg?.previewRotation ?? 0;
  const sideways = rot === 90 || rot === 270;
  const mediaStyle: CSSProperties = {
    transform: `${sideways ? 'translate(-50%,-50%) ' : ''}rotate(${rot}deg) scaleX(${cfg?.mirrorPreview ? -1 : 1})`,
    ...(sideways ? { left: '50%', top: '50%', width: box.h, height: box.w, inset: 'auto' } : {}),
  };
  const fit = cfg?.previewFit === 'contain' ? 'contain' : 'cover';

  return (
    <div className="cam" style={style} ref={boxRef}>
      {mode === 'browser' ? (
        // Always mounted: the stream is re-attached transparently after a reconnect.
        <video ref={videoRef} className={`lv ${fit}`} style={{ ...mediaStyle, visibility: live ? 'visible' : 'hidden' }} autoPlay muted playsInline />
      ) : mode === 'server' && cfg?.liveViewUrl ? (
        // Canvas, not <img src=mjpeg>: Chrome leaves stale overlay pixels (countdown digits) on MJPEG images.
        // While the DSLR shoots no frames arrive, so the last frame simply stays.
        <canvas ref={canvasRef} className={`lv ${fit}`} style={mediaStyle} />
      ) : null}
      {shotUrl ? <img className={`lv ${fit}`} src={shotUrl} alt="" draggable={false} /> : null}
      {hole ? <SlotMask w={box.w} h={box.h} ratio={hole} /> : null}
      {(mode === 'browser' && !live) || mode === 'mock' || (mode === 'server' && !cfg?.liveViewUrl) ? (
        <>
          <div className="b1" style={{ animationDelay: delays.d20 }} />
          <div className="b2" style={{ animationDelay: delays.d20 }} />
          <svg className="sil" viewBox="0 0 100 200" style={{ animationDelay: delays.d9 }}>
            <g opacity=".5" fill="#2B2A4C">
              <circle cx="50" cy="38" r="24" />
              <rect x="10" y="56" width="80" height="150" rx="40" />
            </g>
          </svg>
        </>
      ) : null}
      <div className="vf">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className={`live ${live ? '' : 'off'}`}>● LIVE</div>
      {children}
    </div>
  );
}
