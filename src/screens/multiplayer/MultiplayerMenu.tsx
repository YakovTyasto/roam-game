import { useState } from 'react';
import { ArrowLeft, Plus, LogIn, AlertTriangle, Users, Minus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { DifficultyCards } from '../../components/difficulty/DifficultyCards';
import type { Difficulty } from '../../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../../config/difficulty';
import { MIN_PLAYERS, MAX_PLAYERS } from '../../multiplayer/types';
import { ROOM_CODE_LENGTH, normalizeRoomCode } from '../../multiplayer/roomCode';
import styles from './multiplayer.module.css';

interface MultiplayerMenuProps {
  initialCode: string;
  playerName: string;
  busy: boolean;
  error: string | null;
  onCreate: (options: { difficulty: Difficulty; maxPlayers: number }) => void;
  onJoin: (code: string) => void;
  onClearError: () => void;
  onBack: () => void;
}

export function MultiplayerMenu({
  initialCode,
  playerName,
  busy,
  error,
  onCreate,
  onJoin,
  onClearError,
  onBack,
}: MultiplayerMenuProps) {
  const [code, setCode] = useState(initialCode);
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [maxPlayers, setMaxPlayers] = useState(2);

  const handleChangeCode = (value: string) => {
    onClearError();
    setCode(normalizeRoomCode(value));
  };

  const codeReady = code.length === ROOM_CODE_LENGTH;

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden />
            Private party
          </span>
          <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
            <ArrowLeft size={20} aria-hidden />
          </Button>
        </div>

        <h1 className={styles.title}>
          Play friends in <span className={styles.titleAccent}>real time</span>
        </h1>
        <p className={styles.lede}>
          Everyone gets the same locations in the same order. Guess independently,
          then compare — closest to each spot tops the round. Up to {MAX_PLAYERS}{' '}
          players.
        </p>

        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <AlertTriangle size={18} className={styles.noticeIcon} aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <p className={styles.playingAs}>
          Playing as <strong>{playerName}</strong>
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCreate({ difficulty, maxPlayers });
          }}
        >
          <span className={styles.label}>Difficulty</span>
          <DifficultyCards
            value={difficulty}
            onChange={(d) => {
              onClearError();
              setDifficulty(d);
            }}
            compact
            disabled={busy}
          />

          <div className={styles.capacityRow}>
            <div>
              <span className={styles.label}>Players</span>
              <p className={styles.footNote} style={{ margin: 0 }}>
                Start any time once 2 have joined.
              </p>
            </div>
            <div className={styles.stepper} role="group" aria-label="Maximum players">
              <Button
                variant="ghost"
                iconOnly
                onClick={() => setMaxPlayers((n) => Math.max(MIN_PLAYERS, n - 1))}
                disabled={busy || maxPlayers <= MIN_PLAYERS}
                aria-label="Fewer players"
              >
                <Minus size={18} aria-hidden />
              </Button>
              <span className={styles.stepperValue} aria-live="polite">
                {maxPlayers}
              </span>
              <Button
                variant="ghost"
                iconOnly
                onClick={() => setMaxPlayers((n) => Math.min(MAX_PLAYERS, n + 1))}
                disabled={busy || maxPlayers >= MAX_PLAYERS}
                aria-label="More players"
              >
                <Plus size={18} aria-hidden />
              </Button>
            </div>
          </div>

          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              <Plus size={20} aria-hidden />
              Create private room
            </Button>
          </div>
        </form>

        <div className={styles.divider}>or join</div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onJoin(code);
          }}
        >
          <label className={styles.field}>
            <span className={styles.label}>Room code</span>
            <div className={styles.joinRow}>
              <input
                className={`${styles.input} ${styles.codeInput}`}
                value={code}
                onChange={(e) => handleChangeCode(e.target.value)}
                placeholder="ABC234"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={ROOM_CODE_LENGTH}
                enterKeyHint="go"
                aria-label={`Room code, ${ROOM_CODE_LENGTH} characters`}
              />
            </div>
          </label>

          <div className={styles.actions}>
            <Button type="submit" variant="ghost" size="lg" block disabled={busy || !codeReady}>
              <LogIn size={20} aria-hidden />
              Join game
            </Button>
          </div>
        </form>

        {busy && (
          <p className={styles.waiting} aria-live="polite">
            <span className={styles.spinnerDot} aria-hidden />
            <span>
              <Users size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> Connecting…
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
