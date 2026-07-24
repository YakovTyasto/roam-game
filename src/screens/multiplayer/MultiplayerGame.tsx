import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Flag,
  LogOut,
  MapPin,
  Timer,
  Trophy,
  Wifi,
} from 'lucide-react';
import type { LatLng, Preferences } from '../../types';
import { formatDistance } from '../../utils/distance';
import { useIsDesktop, useIsTablet } from '../../hooks/useMediaQuery';
import { StreetView } from '../../components/street/StreetView';
import { WorldMap } from '../../components/map/WorldMap';
import { LoadingOverlay } from '../../components/ui/LoadingOverlay';
import { Button } from '../../components/ui/Button';
import type { RoomView } from '../../multiplayer/machine';
import type { MpRoom } from '../../multiplayer/types';
import mapStyles from '../../components/map/MapPanel.module.css';
import styles from './game.module.css';

interface MultiplayerGameProps {
  room: MpRoom;
  view: RoomView;
  secondsLeft: number | null;
  opponentOnline: boolean;
  connection: 'connecting' | 'connected' | 'disconnected';
  busy: boolean;
  units: Preferences['units'];
  onSubmitGuess: (lat: number, lng: number) => void;
  onAdvance: () => void;
  onLeave: () => void;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface PlayerStatus {
  label: string;
  dotClass: string;
}

export function MultiplayerGame({
  room,
  view,
  secondsLeft,
  opponentOnline,
  connection,
  busy,
  units,
  onSubmitGuess,
  onAdvance,
  onLeave,
}: MultiplayerGameProps) {
  const isDesktop = useIsDesktop();
  const isTablet = useIsTablet();
  const device = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone';
  const isMobileLike = device === 'phone' || device === 'tablet';

  const round = view.currentRound;
  const isResult = view.status === 'round-result';
  const isSubmitted = view.status === 'submitted';
  const locked = isSubmitted || isResult || view.myGuess != null;

  const [pendingGuess, setPendingGuess] = useState<LatLng | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  // Track which pano id has finished positioning. Comparing against the current
  // round's pano id (rather than a boolean we reset on round change) avoids a
  // race between the child's onReady and a parent reset effect.
  const [readyPanoId, setReadyPanoId] = useState<string | null>(null);

  // Reset per-round local state whenever the round changes.
  useEffect(() => {
    setPendingGuess(null);
    setMapExpanded(false);
  }, [round?.id]);

  const handlePlaceGuess = useCallback(
    (latlng: LatLng) => {
      if (locked) return;
      setPendingGuess(latlng);
    },
    [locked],
  );

  const handleSubmit = useCallback(() => {
    if (!pendingGuess || locked) return;
    onSubmitGuess(pendingGuess.lat, pendingGuess.lng);
  }, [pendingGuess, locked, onSubmitGuess]);

  if (!round) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <LoadingOverlay label="Loading round…" />
      </div>
    );
  }

  // Guess shown on the map: submitted guess if present, else the pending pin.
  const myGuessLatLng: LatLng | null = view.myGuess
    ? { lat: view.myGuess.lat, lng: view.myGuess.lng }
    : pendingGuess;

  const opponentGuessLatLng: LatLng | null =
    isResult && view.opponentGuess
      ? { lat: view.opponentGuess.lat, lng: view.opponentGuess.lng }
      : null;

  const actualLocation =
    isResult && view.currentTarget
      ? {
          id: view.currentTarget.locationId,
          lat: view.currentTarget.lat,
          lng: view.currentTarget.lng,
          label: view.currentTarget.label,
          country: view.currentTarget.country,
        }
      : null;

  const myScore = view.myGuess?.score ?? 0;
  const oppScore = view.opponentGuess?.score ?? 0;
  const isLastRound = room.currentRound >= room.totalRounds;

  const meStatus = playerStatus({
    exploring: !view.myGuess,
    submitted: view.myGuess != null,
    online: true,
    isResult,
  });
  const oppStatus = playerStatus({
    exploring: !view.opponentSubmitted,
    submitted: view.opponentSubmitted,
    online: opponentOnline,
    isResult,
  });

  const isOpen = isResult || mapExpanded;
  const panelClasses = [
    mapStyles.panel,
    mapStyles[device],
    mapExpanded ? mapStyles.expanded : '',
    isResult ? mapStyles.result : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="noselect" style={{ position: 'absolute', inset: 0 }}>
      <StreetView
        panorama={{ panoId: round.panoId, heading: round.heading, pitch: round.pitch, zoom: round.zoom }}
        onReady={() => setReadyPanoId(round.panoId)}
        onLoadError={() => setReadyPanoId(round.panoId)}
      />

      {/* ── HUD ─────────────────────────────────────────── */}
      <div className={styles.hud}>
        <div className={styles.topLine}>
          <div className={styles.pillRow}>
            <div className={styles.pill}>
              <MapPin size={16} className={styles.icon} aria-hidden />
              <span className={styles.label}>Round</span>
              <span className={styles.value}>
                {round.roundNumber}
                <span aria-hidden> / </span>
                <span className="sr-only"> of </span>
                {room.totalRounds}
              </span>
            </div>
            {secondsLeft !== null && (
              <div className={styles.pill} role="timer" aria-live="off">
                <Timer size={16} className={styles.icon} aria-hidden />
                <span
                  className={`${styles.value} ${secondsLeft <= 10 ? styles.timerLow : ''}`}
                >
                  {formatClock(secondsLeft)}
                </span>
              </div>
            )}
          </div>
          <Button variant="subtle" onClick={onLeave} aria-label="Leave match">
            <LogOut size={18} aria-hidden />
          </Button>
        </div>

        <div className={styles.scoreboard}>
          <ScorePill
            me
            name={view.me?.displayName ?? 'You'}
            score={view.me?.totalScore ?? 0}
            status={meStatus}
          />
          <ScorePill
            me={false}
            name={view.opponent?.displayName ?? 'Opponent'}
            score={view.opponent?.totalScore ?? 0}
            status={oppStatus}
          />
        </div>

        {connection === 'disconnected' && (
          <div className={styles.connBanner} role="status">
            <span className={styles.connSpinner} aria-hidden />
            <Wifi size={13} aria-hidden />
            Reconnecting…
          </div>
        )}
      </div>

      {/* Mobile entry point when the sheet is closed. */}
      {isMobileLike && !isOpen && (
        <button
          className={mapStyles.fab}
          onClick={() => setMapExpanded(true)}
          type="button"
        >
          <span className={mapStyles.fabDot} aria-hidden />
          {locked ? 'View map' : 'Make your guess'}
        </button>
      )}

      {isMobileLike && isOpen && (
        <button
          className={mapStyles.scrim}
          aria-label={isResult ? 'Result' : 'Close map'}
          onClick={isResult ? undefined : () => setMapExpanded(false)}
          tabIndex={-1}
        />
      )}

      <section className={panelClasses} aria-label={isResult ? 'Round result' : 'Guess map'}>
        {isMobileLike && !isResult && (
          <button
            className={mapStyles.handle}
            onClick={() => setMapExpanded(false)}
            aria-label="Collapse map"
            type="button"
          >
            <span className={mapStyles.handleBar} aria-hidden />
          </button>
        )}

        <div className={mapStyles.mapArea}>
          <WorldMap
            mode={isResult ? 'result' : 'guess'}
            guess={myGuessLatLng}
            actual={actualLocation}
            opponentGuess={opponentGuessLatLng}
            interactive={!locked}
            onPlaceGuess={handlePlaceGuess}
          />
        </div>

        {isResult ? (
          <div className={mapStyles.footer}>
            <div className={styles.resultFooter}>
              <RoundOutcome myScore={myScore} oppScore={oppScore} />
              {actualLocation && (
                <div className={styles.locationName}>
                  <Flag size={16} className={styles.flag} aria-hidden />
                  <span>
                    {actualLocation.label} · {actualLocation.country}
                  </span>
                </div>
              )}
              <div className={styles.resultGrid}>
                <ResultColumn
                  me
                  name={view.me?.displayName ?? 'You'}
                  distanceKm={view.myGuess?.distanceKm ?? null}
                  score={myScore}
                  units={units}
                />
                <ResultColumn
                  me={false}
                  name={view.opponent?.displayName ?? 'Opponent'}
                  distanceKm={view.opponentGuess?.distanceKm ?? null}
                  score={oppScore}
                  units={units}
                />
              </div>
              <Button variant="primary" size="lg" block onClick={onAdvance} disabled={busy}>
                {isLastRound ? (
                  <>
                    <Trophy size={18} aria-hidden />
                    See final results
                  </>
                ) : (
                  <>
                    Next round
                    <ArrowRight size={18} aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className={mapStyles.footer}>
            <span className={mapStyles.hint}>
              {locked
                ? 'Guess locked in — waiting for your opponent…'
                : myGuessLatLng
                  ? 'Tap again or drag to adjust, then submit.'
                  : 'Tap the map to drop your guess.'}
            </span>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={locked || !pendingGuess || busy}
              aria-label="Submit guess"
            >
              <Check size={18} aria-hidden />
              {locked ? 'Submitted' : 'Submit'}
            </Button>
          </div>
        )}
      </section>

      {readyPanoId !== round.panoId && <LoadingOverlay label="Loading panorama…" />}
    </div>
  );
}

// ── Small presentational helpers ───────────────────────────────────────────

function ScorePill({
  me,
  name,
  score,
  status,
}: {
  me: boolean;
  name: string;
  score: number;
  status: PlayerStatus;
}) {
  return (
    <div className={`${styles.sbPlayer} ${me ? styles.sbPlayerMe : ''}`}>
      <div className={styles.sbTop}>
        <span className={styles.sbName}>
          {name}
          {me && ' (you)'}
        </span>
        <span className={styles.sbScore}>{score.toLocaleString()}</span>
      </div>
      <span className={styles.sbStatus}>
        <span className={`${styles.sbDot} ${status.dotClass}`} aria-hidden />
        {status.label}
      </span>
    </div>
  );
}

function ResultColumn({
  me,
  name,
  distanceKm,
  score,
  units,
}: {
  me: boolean;
  name: string;
  distanceKm: number | null;
  score: number;
  units: Preferences['units'];
}) {
  return (
    <div className={`${styles.resultCol} ${me ? styles.resultColMe : ''}`}>
      <span className={styles.resultColHead}>
        <span
          className={`${styles.resultSwatch} ${me ? styles.swatchMe : styles.swatchOpp}`}
          aria-hidden
        />
        {name}
        {me && ' (you)'}
      </span>
      {distanceKm !== null ? (
        <span className={styles.resultDistance}>{formatDistance(distanceKm, units)}</span>
      ) : (
        <span className={styles.missText}>No guess</span>
      )}
      <span className={styles.resultScore}>{score.toLocaleString()}</span>
    </div>
  );
}

function RoundOutcome({ myScore, oppScore }: { myScore: number; oppScore: number }) {
  let text: string;
  let cls: string;
  if (myScore > oppScore) {
    text = 'You won the round';
    cls = styles.roundOutcomeWin;
  } else if (oppScore > myScore) {
    text = 'Opponent won the round';
    cls = styles.roundOutcomeLoss;
  } else {
    text = 'Round tied';
    cls = styles.roundOutcomeDraw;
  }
  return (
    <div className={`${styles.roundOutcome} ${cls}`}>
      <Trophy size={16} aria-hidden />
      {text}
    </div>
  );
}

function playerStatus({
  exploring,
  submitted,
  online,
  isResult,
}: {
  exploring: boolean;
  submitted: boolean;
  online: boolean;
  isResult: boolean;
}): PlayerStatus {
  if (!online) {
    return { label: 'Disconnected', dotClass: styles.sbDotOffline };
  }
  if (isResult) {
    return { label: 'Round complete', dotClass: styles.sbDotSubmitted };
  }
  if (submitted) {
    return { label: 'Guess submitted', dotClass: styles.sbDotSubmitted };
  }
  if (exploring) {
    return { label: 'Exploring', dotClass: styles.sbDotExploring };
  }
  return { label: 'Waiting', dotClass: styles.sbDot };
}
