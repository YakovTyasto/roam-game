import { useEffect, useState } from 'react';
import type { Preferences } from '../../types';
import { APP } from '../../config/app';
import { MAX_PLAYER_NAME_LENGTH } from '../../multiplayer/playerName';
import { Button } from '../ui/Button';
import styles from './SettingsContent.module.css';

interface SettingsContentProps {
  preferences: Preferences;
  bestScore: number;
  /** Current display name (null before onboarding). */
  playerName: string | null;
  /** Whether online services are reachable (affects the name-change hint). */
  online: boolean;
  savingName: boolean;
  nameError: string | null;
  onChangeName: (name: string) => void;
  onChange: (patch: Partial<Preferences>) => void;
  onResetBest: () => void;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} aria-hidden />
    </button>
  );
}

export function SettingsContent({
  preferences,
  bestScore,
  playerName,
  online,
  savingName,
  nameError,
  onChangeName,
  onChange,
  onResetBest,
}: SettingsContentProps) {
  const [nameDraft, setNameDraft] = useState(playerName ?? '');
  const [editingName, setEditingName] = useState(false);

  // Keep the draft in sync when the confirmed name changes (e.g. after save).
  useEffect(() => {
    if (!editingName) setNameDraft(playerName ?? '');
  }, [playerName, editingName]);

  const dirty = nameDraft.trim().length > 0 && nameDraft.trim() !== playerName;

  return (
    <div>
      <div className={styles.list}>
        {playerName !== null && (
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Display name</span>
              <span className={styles.rowHint}>
                Shown on multiplayer scoreboards and the weekly leaderboard.
                {!online && ' Online services are currently unavailable.'}
              </span>
              {nameError && (
                <span className={styles.rowHint} role="alert" style={{ color: 'var(--danger)' }}>
                  {nameError}
                </span>
              )}
              <div className={styles.nameEdit}>
                <input
                  className={styles.nameInput}
                  value={nameDraft}
                  onFocus={() => setEditingName(true)}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={MAX_PLAYER_NAME_LENGTH}
                  aria-label="Display name"
                  autoComplete="nickname"
                />
                <Button
                  variant="primary"
                  onClick={() => {
                    onChangeName(nameDraft);
                    setEditingName(false);
                  }}
                  disabled={!dirty || savingName}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        )}
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Round timer</span>
            <span className={styles.rowHint}>
              Show a countdown while you explore.
            </span>
          </div>
          <Toggle
            label="Round timer"
            checked={preferences.timer}
            onChange={(timer) => onChange({ timer })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Distance units</span>
            <span className={styles.rowHint}>Kilometres or miles.</span>
          </div>
          <div className={styles.segment} role="group" aria-label="Distance units">
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={preferences.units === 'metric'}
              onClick={() => onChange({ units: 'metric' })}
            >
              km
            </button>
            <button
              type="button"
              className={styles.segmentButton}
              aria-pressed={preferences.units === 'imperial'}
              onClick={() => onChange({ units: 'imperial' })}
            >
              mi
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Reduce motion</span>
            <span className={styles.rowHint}>
              Minimise animations and transitions.
            </span>
          </div>
          <Toggle
            label="Reduce motion"
            checked={preferences.reduceMotion}
            onChange={(reduceMotion) => onChange({ reduceMotion })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Best score</span>
            <span className={styles.rowHint}>
              {bestScore > 0
                ? `${bestScore.toLocaleString()} / ${(
                    APP.maxRoundScore * APP.roundsPerGame
                  ).toLocaleString()}`
                : 'No games completed yet.'}
            </span>
          </div>
          <button
            type="button"
            className={styles.segmentButton}
            onClick={onResetBest}
            disabled={bestScore <= 0}
            style={{
              border: '1px solid var(--panel-border)',
              opacity: bestScore <= 0 ? 0.5 : 1,
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <p className={styles.footerNote}>
        Preferences and your best score are stored only in this browser.
      </p>
    </div>
  );
}
