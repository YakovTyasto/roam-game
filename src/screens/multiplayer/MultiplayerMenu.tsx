import { useState } from 'react';
import { ArrowLeft, Plus, LogIn, AlertTriangle, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { MAX_PLAYER_NAME_LENGTH } from '../../multiplayer/playerName';
import { ROOM_CODE_LENGTH, normalizeRoomCode } from '../../multiplayer/roomCode';
import styles from './multiplayer.module.css';

interface MultiplayerMenuProps {
  initialCode: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onClearError: () => void;
  onBack: () => void;
}

export function MultiplayerMenu({
  initialCode,
  busy,
  error,
  onCreate,
  onJoin,
  onClearError,
  onBack,
}: MultiplayerMenuProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);

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
            Private 1v1
          </span>
          <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
            <ArrowLeft size={20} aria-hidden />
          </Button>
        </div>

        <h1 className={styles.title}>
          Play a friend in <span className={styles.titleAccent}>real time</span>
        </h1>
        <p className={styles.lede}>
          Same five locations, same order. Guess independently, then compare —
          closest to each spot wins the round.
        </p>

        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <AlertTriangle size={18} className={styles.noticeIcon} aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCreate(name);
          }}
        >
          <label className={styles.field}>
            <span className={styles.label}>Your display name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => {
                onClearError();
                setName(e.target.value);
              }}
              placeholder="e.g. Alex"
              maxLength={MAX_PLAYER_NAME_LENGTH}
              autoComplete="nickname"
              enterKeyHint="done"
              aria-label="Your display name"
            />
          </label>

          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              disabled={busy}
            >
              <Plus size={20} aria-hidden />
              Create private game
            </Button>
          </div>
        </form>

        <div className={styles.divider}>or join</div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onJoin(code, name);
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
            <Button
              type="submit"
              variant="ghost"
              size="lg"
              block
              disabled={busy || !codeReady}
            >
              <LogIn size={20} aria-hidden />
              Join game
            </Button>
          </div>
        </form>

        {busy && (
          <p className={styles.waiting} aria-live="polite">
            <span className={styles.spinnerDot} aria-hidden />
            <span>
              <Users size={14} aria-hidden style={{ verticalAlign: '-2px' }} />{' '}
              Connecting…
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
