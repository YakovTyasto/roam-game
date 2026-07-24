import { ArrowRight, Check, Flag, Maximize2, Minimize2 } from 'lucide-react';
import type { GameLocation, LatLng, Preferences } from '../../types';
import { formatDistance } from '../../utils/distance';
import { APP } from '../../config/app';
import { Button } from '../ui/Button';
import { WorldMap } from './WorldMap';
import styles from './MapPanel.module.css';

export type Device = 'phone' | 'tablet' | 'desktop';

interface MapPanelProps {
  device: Device;
  mode: 'guess' | 'result';
  expanded: boolean;
  onOpen: () => void;
  onClose: () => void;
  guess: LatLng | null;
  actual: GameLocation | null;
  onPlaceGuess: (latlng: LatLng) => void;
  onConfirm: () => void;
  onNext: () => void;
  isLastRound: boolean;
  distanceKm: number | null;
  score: number | null;
  units: Preferences['units'];
}

export function MapPanel({
  device,
  mode,
  expanded,
  onOpen,
  onClose,
  guess,
  actual,
  onPlaceGuess,
  onConfirm,
  onNext,
  isLastRound,
  distanceKm,
  score,
  units,
}: MapPanelProps) {
  const isResult = mode === 'result';
  const isMobileLike = device === 'phone' || device === 'tablet';
  const isOpen = isResult || expanded;

  const panelClasses = [
    styles.panel,
    styles[device],
    expanded ? styles.expanded : '',
    isResult ? styles.result : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {/* Entry point for mobile/tablet when the sheet is closed. */}
      {isMobileLike && !isOpen && (
        <button className={styles.fab} onClick={onOpen} type="button">
          <span className={styles.fabDot} aria-hidden />
          Make your guess
        </button>
      )}

      {/* Scrim behind the mobile/tablet sheet. */}
      {isMobileLike && isOpen && (
        <button
          className={styles.scrim}
          aria-label={isResult ? 'Result' : 'Close map'}
          onClick={isResult ? undefined : onClose}
          tabIndex={-1}
        />
      )}

      <section
        className={panelClasses}
        aria-label={isResult ? 'Round result' : 'Guess map'}
      >
        {/* Drag handle / collapse affordance for sheets. */}
        {isMobileLike && !isResult && (
          <button
            className={styles.handle}
            onClick={onClose}
            aria-label="Collapse map"
            type="button"
          >
            <span className={styles.handleBar} aria-hidden />
          </button>
        )}

        <div className={styles.mapArea}>
          <WorldMap
            mode={mode}
            guess={guess}
            actual={actual}
            interactive={!isResult}
            onPlaceGuess={onPlaceGuess}
          />

          {/* Desktop expand/collapse toggle. */}
          {device === 'desktop' && !isResult && (
            <div className={styles.cardToggle}>
              <Button
                variant="subtle"
                iconOnly
                onClick={expanded ? onClose : onOpen}
                aria-label={expanded ? 'Shrink map' : 'Enlarge map'}
              >
                {expanded ? (
                  <Minimize2 size={18} aria-hidden />
                ) : (
                  <Maximize2 size={18} aria-hidden />
                )}
              </Button>
            </div>
          )}
        </div>

        {isResult ? (
          <div className={styles.footer}>
            <div className={styles.resultStats}>
              <div className={styles.resultBlock}>
                <span className={styles.resultLabel}>Distance</span>
                <span className={styles.resultValue}>
                  {distanceKm !== null ? formatDistance(distanceKm, units) : '—'}
                </span>
              </div>
              <div className={styles.resultBlock}>
                <span className={styles.resultLabel}>Round score</span>
                <span className={`${styles.resultValue} ${styles.resultScore}`}>
                  {(score ?? 0).toLocaleString()}
                  <span className={styles.resultLabel}> / {APP.maxRoundScore.toLocaleString()}</span>
                </span>
              </div>
            </div>
            {actual && (
              <div className={styles.locationName}>
                <Flag size={18} className={styles.flag} aria-hidden />
                <span>
                  {actual.label}
                  <span className={styles.resultLabel}> · {actual.country}</span>
                </span>
              </div>
            )}
            <Button variant="primary" size="lg" block onClick={onNext}>
              {isLastRound ? 'See final score' : 'Next round'}
              <ArrowRight size={18} aria-hidden />
            </Button>
          </div>
        ) : (
          <div className={styles.footer}>
            <span className={styles.hint}>
              {guess
                ? 'Tap again or drag the pin to adjust.'
                : 'Tap the map to drop your guess.'}
            </span>
            <Button
              variant="primary"
              onClick={onConfirm}
              disabled={!guess}
              aria-label="Confirm guess"
            >
              <Check size={18} aria-hidden />
              Confirm
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
