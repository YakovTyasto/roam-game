import { useState } from 'react';
import { ArrowRight, MapPin, AlertTriangle, WifiOff } from 'lucide-react';
import { APP } from '../config/app';
import { Button } from '../components/ui/Button';
import { MAX_PLAYER_NAME_LENGTH } from '../multiplayer/playerName';
import styles from './multiplayer/multiplayer.module.css';

interface NameScreenProps {
  busy: boolean;
  error: string | null;
  /** Whether online services are configured (affects the sub-copy). */
  online: boolean;
  onSubmit: (name: string) => void;
}

/**
 * First-visit onboarding: pick a display name before playing. Shown only when
 * no cached/server profile exists, so returning players never see it. The
 * anonymous Supabase user id remains the authoritative identity; this name is
 * just how the player appears on scoreboards and the leaderboard.
 */
export function NameScreen({ busy, error, online, onSubmit }: NameScreenProps) {
  const [name, setName] = useState('');

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden />
            Welcome to {APP.name}
          </span>
        </div>

        <h1 className={styles.title}>
          Pick a <span className={styles.titleAccent}>display name</span>
        </h1>
        <p className={styles.lede}>
          It shows up on multiplayer scoreboards and the weekly leaderboard. No
          account, email, or password — just a name. You can change it any time
          in settings.
        </p>

        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <AlertTriangle size={18} className={styles.noticeIcon} aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {!online && (
          <div className={styles.notice} role="status">
            <WifiOff size={18} className={styles.noticeIcon} aria-hidden />
            <span>
              Online services are unavailable right now — your name is saved on
              this device and solo play works offline.
            </span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(name);
          }}
        >
          <label className={styles.field}>
            <span className={styles.label}>Your display name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={MAX_PLAYER_NAME_LENGTH}
              autoComplete="nickname"
              enterKeyHint="done"
              autoFocus
              aria-label="Your display name"
            />
          </label>

          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              disabled={busy || name.trim().length === 0}
            >
              <MapPin size={20} aria-hidden />
              {busy ? 'Saving…' : 'Start exploring'}
              {!busy && <ArrowRight size={18} aria-hidden />}
            </Button>
          </div>
        </form>

        <p className={styles.footNote}>
          Your identity lives in this browser. Clearing site data or switching
          devices creates a fresh anonymous identity and name.
        </p>
      </div>
    </div>
  );
}
