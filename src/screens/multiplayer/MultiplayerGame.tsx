import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Flag, LogOut, MapPin, Timer, Trophy, Wifi } from 'lucide-react';
import type { LatLng, Preferences } from '../../types';
import { formatDistance } from '../../utils/distance';
import { useIsDesktop, useIsTablet } from '../../hooks/useMediaQuery';
import { StreetView } from '../../components/street/StreetView';
import { WorldMap, type OtherGuess } from '../../components/map/WorldMap';
import { LoadingOverlay } from '../../components/ui/LoadingOverlay';
import { Button } from '../../components/ui/Button';
import type { RoomView } from '../../multiplayer/machine';
import { rankByScore } from '../../multiplayer/ranking';
import type { MpPlayer, MpRoom } from '../../multiplayer/types';
import mapStyles from '../../components/map/MapPanel.module.css';
import styles from './game.module.css';

interface MultiplayerGameProps {
  room: MpRoom;
  view: RoomView;
  secondsLeft: number | null;
  onlineUserIds: string[];
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

export function MultiplayerGame({
  room,
  view,
  secondsLeft,
  onlineUserIds,
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
  const [readyPanoId, setReadyPanoId] = useState<string | null>(null);
  const online = new Set(onlineUserIds);

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

  const myGuessLatLng: LatLng | null = view.myGuess
    ? { lat: view.myGuess.lat, lng: view.myGuess.lng }
    : pendingGuess;

  // On reveal, all other players' guesses (up to 7) are shown alongside the answer.
  const otherGuesses: OtherGuess[] = isResult
    ? view.roundGuesses
        .filter((g) => g.userId !== view.me?.userId)
        .map((g) => ({
          lat: g.lat,
          lng: g.lng,
          label: view.players.find((p) => p.userId === g.userId)?.displayName,
        }))
    : [];

  const actualLocation =
    isResult && view.currentTarget
      ? {
          id: view.currentTarget.locationId,
          lat: view.currentTarget.lat,
          lng: view.currentTarget.lng,
          label: view.currentTarget.label,
          country: view.currentTarget.country,
          difficulty: room.difficulty,
        }
      : null;

  const isLastRound = room.currentRound >= room.totalRounds;

  // Scoreboard: sort by running total (desc), tie-break by slot.
  const scoreboard = [...view.players].sort(
    (a, b) => b.totalScore - a.totalScore || a.slot - b.slot,
  );

  // Round result ranking across every player (missing guess = 0).
  const roundScoreOf = (p: MpPlayer) =>
    view.roundGuesses.find((g) => g.userId === p.userId)?.score ?? 0;
  const rankedRound = isResult
    ? rankByScore(view.players, roundScoreOf, (a, b) => a.slot - b.slot)
    : [];

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
            {!isResult && (
              <div className={styles.pill}>
                <Check size={16} className={styles.icon} aria-hidden />
                <span className={styles.value}>
                  {view.submittedCount}/{view.eligibleCount}
                </span>
                <span className={styles.label}>in</span>
              </div>
            )}
            {secondsLeft !== null && (
              <div className={styles.pill} role="timer" aria-live="off">
                <Timer size={16} className={styles.icon} aria-hidden />
                <span className={`${styles.value} ${secondsLeft <= 10 ? styles.timerLow : ''}`}>
                  {formatClock(secondsLeft)}
                </span>
              </div>
            )}
          </div>
          <Button variant="subtle" onClick={onLeave} aria-label="Leave match">
            <LogOut size={18} aria-hidden />
          </Button>
        </div>

        {/* Dynamic scoreboard for 2–8 players. */}
        <div className={styles.partyScoreboard}>
          {scoreboard.map((p) => {
            const isMe = p.userId === view.me?.userId;
            const submitted = isMe && view.myGuess != null;
            const isOnline = isMe || online.has(p.userId);
            const left = p.connectionStatus === 'left';
            return (
              <div
                key={p.id}
                className={`${styles.sbChip} ${isMe ? styles.sbChipMe : ''} ${left ? styles.sbChipLeft : ''}`}
              >
                <span
                  className={`${styles.sbChipDot} ${
                    left
                      ? styles.sbDotOffline
                      : submitted
                        ? styles.sbDotSubmitted
                        : isOnline
                          ? styles.sbDotExploring
                          : styles.sbDotOffline
                  }`}
                  aria-hidden
                />
                <span className={styles.sbChipName}>
                  {p.displayName}
                  {isMe && ' (you)'}
                  {left && <span className="sr-only"> (left)</span>}
                </span>
                <span className={styles.sbChipScore}>{p.totalScore.toLocaleString()}</span>
              </div>
            );
          })}
        </div>

        {connection === 'disconnected' && (
          <div className={styles.connBanner} role="status">
            <span className={styles.connSpinner} aria-hidden />
            <Wifi size={13} aria-hidden />
            Reconnecting…
          </div>
        )}
      </div>

      {isMobileLike && !isOpen && (
        <button className={mapStyles.fab} onClick={() => setMapExpanded(true)} type="button">
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
            otherGuesses={otherGuesses}
            interactive={!locked}
            onPlaceGuess={handlePlaceGuess}
          />
        </div>

        {isResult ? (
          <div className={mapStyles.footer}>
            <div className={styles.resultFooter}>
              {actualLocation && (
                <div className={styles.locationName}>
                  <Flag size={16} className={styles.flag} aria-hidden />
                  <span>
                    {actualLocation.label} · {actualLocation.country}
                  </span>
                </div>
              )}
              <ol className={styles.roundRanking} aria-label="Round ranking">
                {rankedRound.map((entry) => {
                  const p = entry.item;
                  const guess = view.roundGuesses.find((g) => g.userId === p.userId);
                  const isMe = p.userId === view.me?.userId;
                  return (
                    <li
                      key={p.id}
                      className={`${styles.rankRow} ${isMe ? styles.rankRowMe : ''}`}
                    >
                      <span className={styles.rankPos}>
                        {entry.rank}
                        {entry.isWinner && (
                          <Trophy size={11} aria-label="Round winner" style={{ marginLeft: 3, color: 'var(--accent)' }} />
                        )}
                      </span>
                      <span className={styles.rankName}>
                        {p.displayName}
                        {isMe && ' (you)'}
                      </span>
                      <span className={styles.rankDist}>
                        {guess ? formatDistance(guess.distanceKm, units) : 'No guess'}
                      </span>
                      <span className={styles.rankScore}>{entry.score.toLocaleString()}</span>
                    </li>
                  );
                })}
              </ol>
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
                ? `Guess locked in — ${view.submittedCount}/${view.eligibleCount} players in…`
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
