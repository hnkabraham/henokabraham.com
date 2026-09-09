'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Plane, Volume2, VolumeX } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DeparturePhase } from '@/lib/departure-motion';
import { startDepartureAudio } from '@/lib/departure-audio';

import DepartureScene from './departure-scene';
type Props = { open: boolean; onClose: () => void };
const captions: Record<DeparturePhase, [string, string]> = {
  preflight: [
    '01 / BEFORE THE FIRST LINE OF CODE',
    'Every idea starts somewhere.',
  ],
  roll: ['02 / TAKEOFF', 'A little curiosity. A lot of lift.'],
  rotate: ['02 / POSITIVE CLIMB', 'Let’s see where this goes.'],
  climb: ['03 / ABOVE THE ORDINARY', 'A different perspective.'],
  arrival: ['WELCOME ABOARD', 'This is my airspace.'],
};

export default function DepartureIntro({ open, onClose }: Props) {
  const [ready, setReady] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<DeparturePhase>('preflight');
  const [sound, setSound] = useState(false);
  const [ending, setEnding] = useState(false);
  const stopAudio = useRef<(() => void) | null>(null);
  const skipButton = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const complete = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    stopAudio.current?.();
    stopAudio.current = null;
    onClose();
  }, [onClose]);
  const arrive = useCallback(() => {
    if (closeTimer.current) return;
    setEnding(true);
    closeTimer.current = setTimeout(complete, 900);
  }, [complete]);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => {
      if (preference.matches) complete();
    };
    onPreference();
    preference.addEventListener('change', onPreference);
    const quietWhenHidden = () => {
      if (document.hidden) {
        stopAudio.current?.();
        stopAudio.current = null;
      }
    };
    document.addEventListener('visibilitychange', quietWhenHidden);
    const watchdog = setTimeout(
      () => setReady((state) => (state === 'loading' ? 'unavailable' : state)),
      15000,
    );
    return () => {
      preference.removeEventListener('change', onPreference);
      document.removeEventListener('visibilitychange', quietWhenHidden);
      clearTimeout(watchdog);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      stopAudio.current?.();
    };
  }, [complete]);
  const launch = () => {
    if (ready === 'unavailable') {
      complete();
      return;
    }
    if (ready !== 'ready' || started) return;
    if (sound) {
      try {
        stopAudio.current = startDepartureAudio();
      } catch {
        setSound(false);
      }
    }
    setStarted(true);
    setPhase('roll');
    skipButton.current?.focus({ preventScroll: true });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) complete();
      }}
    >
      <DialogContent
        className="departure-intro"
        showCloseButton={false}
        data-started={started}
        data-ending={ending}
        data-phase={phase}
        initialFocus={false}
        finalFocus={() => document.getElementById('welcome-title')}
      >
        <DialogTitle className="sr-only">
          Henok Abraham — cleared for takeoff
        </DialogTitle>
        <DialogDescription className="sr-only">
          An optional aviation introduction. Start the takeoff sequence or skip
          to the portfolio. Press Escape to skip at any time.
        </DialogDescription>
        <div className="departure-night" />
        <DepartureScene
          started={started}
          onReady={setReady}
          onPhase={setPhase}
          onComplete={arrive}
        />
        <div className="departure-vignette" />
        <div className="departure-grain" />
        <header className="departure-topline mono">
          <span className="departure-callsign">
            <Plane size={20} strokeWidth={1.4} /> H.A / PERSONAL AIRSPACE
          </span>
          <button
            className="departure-skip"
            onClick={complete}
            ref={skipButton}
          >
            Skip intro <ArrowRight size={16} />
          </button>
        </header>
        <div className="departure-introduction">
          <p className="departure-kicker mono">
            <span /> AN INDEPENDENT DEVELOPER. AN OPEN SKY.
          </p>
          <p className="departure-name">
            Henok
            <br />
            <span>Abraham.</span>
          </p>
          <p className="departure-subtitle">
            Some things are worth
            <br />
            getting off the ground.
          </p>
        </div>
        <div className="departure-launch-panel" inert={started}>
          <div className="departure-clearance mono" aria-live="polite">
            <span className={ready === 'ready' ? 'ready-light' : ''} />{' '}
            {ready === 'loading'
              ? 'PREPARING YOUR AIRCRAFT'
              : ready === 'ready'
                ? 'PREFLIGHT COMPLETE / RUNWAY READY'
                : 'YOUR AIRSPACE IS READY'}
          </div>
          <button
            className="departure-launch"
            onClick={launch}
            disabled={ready === 'loading'}
          >
            <span>
              {ready === 'unavailable'
                ? 'Enter the portfolio'
                : 'Cleared for takeoff'}
            </span>
            <span className="departure-launch-icon">
              <ArrowRight size={23} />
            </span>
          </button>
          <button
            className="departure-audio mono"
            aria-pressed={sound}
            onClick={() => setSound(!sound)}
          >
            {sound ? <Volume2 size={15} /> : <VolumeX size={15} />} SOUND{' '}
            {sound ? 'ON' : 'OFF'}
            <span> · OPTIONAL</span>
          </button>
        </div>
        <div
          className="departure-chapter"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="mono">{captions[phase][0]}</p>
          <p key={phase} className="departure-chapter-title">
            {captions[phase][1]}
          </p>
        </div>
        <footer className="departure-bottomline mono">
          <span>
            HENOK ABRAHAM <span className="departure-footer-divider">/</span>{' '}
            DEVELOPER & EXPLORER
          </span>
          <div className="departure-route" aria-hidden="true">
            <span data-active={phase === 'preflight'}>01 PREFLIGHT</span>
            <i />
            <span data-active={phase === 'roll' || phase === 'rotate'}>
              02 TAKEOFF
            </span>
            <i />
            <span data-active={phase === 'climb' || phase === 'arrival'}>
              03 AIRSPACE
            </span>
          </div>
        </footer>
        <div className="departure-wipe" />
      </DialogContent>
    </Dialog>
  );
}
