import { useState } from 'react';
import { useBooth } from '../store';
import { Icon, Robot } from '../components/basics';
import { backFromPay, selectQrPayment } from '../flow';

/** Dedicated, payment-free start page for admin Free Mode. */
export function PayFree() {
  const status = useBooth((s) => s.session!.status);
  const payError = useBooth((s) => s.payError);
  const busy = useBooth((s) => s.busy);
  const digitalOnly = useBooth((s) => s.config?.freeDigitalOnly === true);
  const [tapped, setTapped] = useState(false);
  const ok = status === 'PAYMENT_SUCCESS';
  const waiting = tapped && !ok && !payError;

  return (
    <main className="scr en free-page" aria-label="Paket foto gratis">
      <div className="free-orb free-orb-one" aria-hidden="true" />
      <div className="free-orb free-orb-two" aria-hidden="true" />
      <div className="free-spark free-spark-one" aria-hidden="true">✦</div>
      <div className="free-spark free-spark-two" aria-hidden="true">✧</div>

      <header className="free-header">
        <button className="free-back" onClick={backFromPay} disabled={ok || waiting || busy === 'cancel'} data-testid="pay-back">
          <Icon n="back" z={28} />
          Kembali
        </button>
        <div className="free-live"><i /> HARI SPESIAL</div>
      </header>

      <section className="free-content">
        <div className="free-copy">
          <div className="free-eyebrow"><span>✦</span> HADIAH KECIL UNTUKMU <span>✦</span></div>
          <h1>Hari ini<br /><em>gratis!</em></h1>
          <p className="free-lead">Senyum terbaikmu, jadi kenangan manis. Yuk, foto-foto!</p>

          <div className="free-perks" aria-label="Termasuk dalam sesi gratis">
            {!digitalOnly ? <div className="free-perk">
              <span className="free-perk-icon print"><Icon n="print" z={32} /></span>
              <span><b>1 cetakan premium</b><small>Dengan frame pilihanmu</small></span>
              <Icon n="check" z={24} />
            </div> : null}
            <div className="free-perk">
              <span className="free-perk-icon digital"><Icon n="qr" z={32} /></span>
              <span><b>Semua foto digital</b><small>Unduh mudah lewat QR</small></span>
              <Icon n="check" z={24} />
            </div>
          </div>

          <div className="free-action">
            {ok ? (
              <div className="free-success" data-testid="pay-ok"><Icon n="check" z={30} /> Siap foto! Sebentar lagi ya</div>
            ) : (
              <button
                className="free-start"
                disabled={waiting}
                onClick={() => {
                  setTapped(true);
                  selectQrPayment();
                }}
                data-testid="free-start"
              >
                <span>{waiting ? 'Menyiapkan studio…' : payError ? 'Coba lagi' : 'MULAI FOTO'}</span>
                <span className="free-start-icon"><Icon n="next" z={34} /></span>
              </button>
            )}
            {payError ? <div className="free-error" role="alert">{payError}</div> : null}
            <div className="free-note"><Icon n="check" z={18} /> Tanpa bayar · Tanpa QRIS · Langsung mulai</div>
          </div>
        </div>

        <div className={`free-art ${ok ? 'cheering' : ''}`} aria-hidden="true">
          <div className="free-halo"><i /><i /><i /></div>
          <div className="free-confetti confetti-a">✦</div>
          <div className="free-confetti confetti-b">✧</div>
          <div className="free-confetti confetti-c">●</div>
          <div className="free-confetti confetti-d">✦</div>
          <div className="free-robot"><Robot m={ok ? 'cheer' : payError ? 'think' : 'hi'} s={480} /></div>
          <div className="free-sticker"><span>100%</span><b>GRATIS</b><i>✦</i></div>
          <div className="free-caption">SENYUM DULU, YUK! <span>♡</span></div>
        </div>
      </section>

      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> {digitalOnly ? 'SEMUA FILE FOTO' : 'SATU CETAKAN + SEMUA FILE FOTO'}</footer>
    </main>
  );
}
