import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CloudOff,
  Copy,
  Link2,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Trophy,
} from 'lucide-react';
import type { Locale } from '../i18n/locale';
import { t } from '../i18n/t';
import type { Preferences } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import { DIFFICULTY_PRESETS } from '../config/difficulty';
import { formatDistance } from '../utils/distance';
import { Button } from '../components/ui/Button';
import { DifficultyCards } from '../components/difficulty/DifficultyCards';
import type { DailyLeaderboard } from '../daily/daily';
import { formatDuration } from '../daily/daily';
import type { ChallengeLookup } from '../challenge/challengeApi';
import {
  CHALLENGE_CODE_LENGTH,
  buildChallengeUrl,
  isValidChallengeCode,
  normalizeChallengeCode,
} from '../challenge/challengeCode';
import type { ShareOutcome } from '../share/share';
import styles from './ChallengeScreen.module.css';

interface ChallengeScreenProps {
  locale: Locale;
  units: Preferences['units'];
  /** Code the screen opened with (deep link), or null for the create/join menu. */
  initialCode: string | null;
  onPlay: (code: string) => void;
  onBack: () => void;
}

type Phase = 'menu' | 'loading' | 'detail' | 'error';

const EXPIRY_OPTIONS = [
  { hours: 24, key: 'challenge.create.expiry_day' },
  { hours: 168, key: 'challenge.create.expiry_week' },
  { hours: 720, key: 'challenge.create.expiry_month' },
] as const;

/**
 * Create / open / share a challenge.
 *
 * The screen owns its own loading and error states rather than delegating to the
 * app shell, because a bad or expired link must land somewhere with a way out —
 * "that link isn't valid" plus a route home, never a blank screen or a spinner
 * that never resolves.
 */
export function ChallengeScreen({
  locale,
  units,
  initialCode,
  onPlay,
  onBack,
}: ChallengeScreenProps) {
  const [phase, setPhase] = useState<Phase>(initialCode ? 'loading' : 'menu');
  const [lookup, setLookup] = useState<ChallengeLookup | null>(null);
  const [code, setCode] = useState(initialCode ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareState, setShareState] = useState<ShareOutcome | null>(null);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const [board, setBoard] = useState<DailyLeaderboard | null>(null);

  // Create form.
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [roundCount, setRoundCount] = useState<5 | 10>(5);
  const [useTimer, setUseTimer] = useState(true);
  const [expiryHours, setExpiryHours] = useState<number>(168);
  const [title, setTitle] = useState('');

  const load = useCallback(async (target: string) => {
    setPhase('loading');
    setError(null);
    try {
      const { lookupChallenge } = await import('../challenge/challengeApi');
      const result = await lookupChallenge(target);
      setLookup(result);
      setCode(target);
      setPhase(result.playable ? 'detail' : 'error');
    } catch {
      // A transport failure is not the same as a bad link, and must not be
      // reported as one.
      setLookup({ playable: false, reason: 'offline' });
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (initialCode) void load(initialCode);
  }, [initialCode, load]);

  // The board is loaded separately and is allowed to fail without taking the
  // screen with it.
  useEffect(() => {
    if (phase !== 'detail' || !lookup?.playable) return;
    let cancelled = false;
    void (async () => {
      try {
        const { fetchChallengeLeaderboard } = await import('../challenge/challengeApi');
        const next = await fetchChallengeLeaderboard(lookup.info.code, 25);
        if (!cancelled) setBoard(next);
      } catch {
        if (!cancelled) setBoard(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, lookup]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { createChallenge } = await import('../challenge/challengeApi');
      const created = await createChallenge({
        difficulty,
        roundCount,
        timerSeconds: useTimer ? DIFFICULTY_PRESETS[difficulty].roundSeconds : null,
        title,
        expiresHours: expiryHours,
      });
      await load(created.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The challenge could not be created.');
    } finally {
      setBusy(false);
    }
  }, [difficulty, roundCount, useTimer, title, expiryHours, load]);

  const doShare = useCallback(
    async (copyOnly: boolean) => {
      if (!lookup?.playable) return;
      const url = buildChallengeUrl(lookup.info.code);
      const { copyLink, share } = await import('../share/share');
      const result = copyOnly
        ? await copyLink(url)
        : await share({
            title: lookup.info.title || 'Roam',
            text: lookup.info.title || undefined,
            url,
          });
      setShareState(result.outcome);
      setShareFallback(result.fallbackText ?? null);
    },
    [lookup],
  );

  // ── Error / unavailable ───────────────────────────────────────────────
  if (phase === 'error' && lookup && !lookup.playable) {
    const reason = lookup.reason;
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <div className={styles.topRow}>
            <span className={styles.eyebrow}>
              <CloudOff size={15} aria-hidden />
              {t(locale, 'challenge.title')}
            </span>
          </div>
          <h1 className={styles.title}>{t(locale, `challenge.error.${reason}`)}</h1>
          <p className={styles.lede}>{t(locale, `challenge.error.${reason}_hint`)}</p>
          <div className={styles.actions}>
            <Button variant="primary" size="lg" block onClick={onBack}>
              <ArrowLeft size={20} aria-hidden />
              {t(locale, 'challenge.error.home')}
            </Button>
            {reason === 'offline' && (
              <Button variant="ghost" size="lg" block onClick={() => void load(code)}>
                <RotateCcw size={18} aria-hidden />
                {t(locale, 'daily.leaderboard.retry')}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Detail ────────────────────────────────────────────────────────────
  if (phase === 'detail' && lookup?.playable) {
    const info = lookup.info;
    const attempt = info.attempt;
    const done = attempt?.status === 'complete';
    const url = buildChallengeUrl(info.code);

    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <div className={styles.topRow}>
            <span className={styles.eyebrow}>
              <Link2 size={15} aria-hidden />
              {info.code}
            </span>
            <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
              <ArrowLeft size={20} aria-hidden />
            </Button>
          </div>

          <h1 className={styles.title}>{info.title || t(locale, 'challenge.title')}</h1>
          <p className={styles.lede}>
            {t(locale, 'challenge.detail.created_by', { name: info.creatorName })} ·{' '}
            {t(locale, 'challenge.detail.rounds', { count: info.roundCount })} ·{' '}
            {DIFFICULTY_PRESETS[(info.difficulty as Difficulty) ?? 'normal']?.label ??
              info.difficulty}
          </p>

          {error && (
            <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
              {error}
            </div>
          )}

          {done ? (
            <dl className={styles.stats}>
              <div className={styles.stat}>
                <dt>{t(locale, 'challenge.detail.your_score')}</dt>
                <dd>{attempt!.totalScore.toLocaleString()}</dd>
              </div>
              <div className={styles.stat}>
                <dt>{t(locale, 'daily.result.distance')}</dt>
                <dd>{formatDistance(attempt!.totalDistanceKm, units)}</dd>
              </div>
              <div className={styles.stat}>
                <dt>{t(locale, 'daily.result.duration')}</dt>
                <dd>{formatDuration(attempt!.durationMs) ?? '—'}</dd>
              </div>
              <div className={styles.stat}>
                <dt>{t(locale, 'challenge.detail.your_rank')}</dt>
                <dd>{board?.self ? `#${board.self.rank}` : '—'}</dd>
              </div>
            </dl>
          ) : (
            <div className={styles.actions}>
              <Button variant="primary" size="lg" block onClick={() => onPlay(info.code)}>
                <Play size={20} aria-hidden />
                {attempt
                  ? t(locale, 'challenge.detail.resume')
                  : t(locale, 'challenge.detail.play')}
              </Button>
            </div>
          )}

          <section className={styles.shareBox} aria-label={t(locale, 'challenge.share.heading')}>
            <h2 className={styles.sectionTitle}>{t(locale, 'challenge.share.heading')}</h2>
            <div className={styles.shareRow}>
              <Button variant="ghost" onClick={() => void doShare(false)}>
                <Share2 size={18} aria-hidden />
                {t(locale, 'challenge.share.button')}
              </Button>
              <Button variant="ghost" onClick={() => void doShare(true)}>
                <Copy size={18} aria-hidden />
                {t(locale, 'challenge.share.copy')}
              </Button>
            </div>
            {/* Outcome is always reported: a tap that appears to do nothing is
                the worst possible result of a share button. */}
            {shareState === 'copied' && (
              <p className={styles.footNote} role="status">
                <Check size={14} aria-hidden /> {t(locale, 'challenge.share.copied')}
              </p>
            )}
            {shareState === 'shared' && (
              <p className={styles.footNote} role="status">
                <Check size={14} aria-hidden /> {t(locale, 'challenge.share.shared')}
              </p>
            )}
            {shareState === 'unsupported' && (
              <p className={styles.footNote} role="status">
                {t(locale, 'challenge.share.failed')}{' '}
                <code className={styles.code}>{shareFallback ?? url}</code>
              </p>
            )}
            <p className={styles.footNote}>
              {t(locale, 'challenge.share.code_label')}: <code className={styles.code}>{info.code}</code>
            </p>
          </section>

          <section className={styles.board} aria-label={t(locale, 'daily.leaderboard.title')}>
            <h2 className={styles.sectionTitle}>
              <Trophy size={16} aria-hidden />
              {t(locale, 'challenge.detail.players', { count: info.playersCompleted })}
            </h2>
            {board && board.entries.length > 0 ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t(locale, 'daily.leaderboard.header_rank')}</th>
                      <th scope="col">{t(locale, 'daily.leaderboard.header_player')}</th>
                      <th scope="col">{t(locale, 'daily.leaderboard.header_score')}</th>
                      <th scope="col">{t(locale, 'daily.leaderboard.header_distance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.entries.map((e) => (
                      <tr
                        key={`${e.rank}-${e.displayName}`}
                        className={e.isSelf ? styles.selfRow : undefined}
                      >
                        <td>{e.rank}</td>
                        <td>
                          {e.displayName}
                          {e.isSelf && (
                            <span className={styles.youTag}>
                              {t(locale, 'daily.leaderboard.you')}
                            </span>
                          )}
                        </td>
                        <td>{e.totalScore.toLocaleString()}</td>
                        <td>{formatDistance(e.totalDistanceKm, units)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.footNote}>{t(locale, 'daily.leaderboard.empty')}</p>
            )}
            <p className={styles.footNote}>{t(locale, 'daily.leaderboard.tiebreak')}</p>
          </section>

          <div className={styles.actions}>
            <Button variant="ghost" block onClick={() => {
              setLookup(null);
              setBoard(null);
              setShareState(null);
              setPhase('menu');
            }}>
              <Plus size={18} aria-hidden />
              {t(locale, 'challenge.detail.play_another')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <p className={styles.footNote} role="status">
            …
          </p>
        </div>
      </div>
    );
  }

  // ── Menu: create or open ──────────────────────────────────────────────
  const joinReady = isValidChallengeCode(joinCode);

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <span className={styles.eyebrow}>
            <Link2 size={15} aria-hidden />
            {t(locale, 'challenge.title')}
          </span>
          <Button variant="subtle" iconOnly onClick={onBack} aria-label="Back to home">
            <ArrowLeft size={20} aria-hidden />
          </Button>
        </div>

        <h1 className={styles.title}>{t(locale, 'challenge.title')}</h1>
        <p className={styles.lede}>{t(locale, 'challenge.subtitle')}</p>

        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <h2 className={styles.sectionTitle}>{t(locale, 'challenge.create.heading')}</h2>

          <label className={styles.field}>
            <span className={styles.label}>{t(locale, 'challenge.create.name_label')}</span>
            <input
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(locale, 'challenge.create.name_placeholder')}
              maxLength={60}
            />
          </label>

          <span className={styles.label}>Difficulty</span>
          <DifficultyCards value={difficulty} onChange={setDifficulty} compact disabled={busy} />

          <fieldset className={styles.chips}>
            <legend className={styles.label}>{t(locale, 'challenge.create.rounds_label')}</legend>
            <div className={styles.chipRow} role="radiogroup" aria-label="Rounds">
              {([5, 10] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={roundCount === n}
                  className={`${styles.chip} ${roundCount === n ? styles.chipOn : ''}`}
                  onClick={() => setRoundCount(n)}
                  disabled={busy}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.chips}>
            <legend className={styles.label}>{t(locale, 'challenge.create.timer_label')}</legend>
            <div className={styles.chipRow} role="radiogroup" aria-label="Round timer">
              <button
                type="button"
                role="radio"
                aria-checked={useTimer}
                className={`${styles.chip} ${useTimer ? styles.chipOn : ''}`}
                onClick={() => setUseTimer(true)}
                disabled={busy}
              >
                {DIFFICULTY_PRESETS[difficulty].roundSeconds}s
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!useTimer}
                className={`${styles.chip} ${!useTimer ? styles.chipOn : ''}`}
                onClick={() => setUseTimer(false)}
                disabled={busy}
              >
                {t(locale, 'challenge.create.timer_off')}
              </button>
            </div>
          </fieldset>

          <fieldset className={styles.chips}>
            <legend className={styles.label}>{t(locale, 'challenge.create.expiry_label')}</legend>
            <div className={styles.chipRow} role="radiogroup" aria-label="Link expiry">
              {EXPIRY_OPTIONS.map((option) => (
                <button
                  key={option.hours}
                  type="button"
                  role="radio"
                  aria-checked={expiryHours === option.hours}
                  className={`${styles.chip} ${expiryHours === option.hours ? styles.chipOn : ''}`}
                  onClick={() => setExpiryHours(option.hours)}
                  disabled={busy}
                >
                  {t(locale, option.key)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              <Plus size={20} aria-hidden />
              {t(locale, 'challenge.create.submit')}
            </Button>
          </div>
        </form>

        <div className={styles.divider} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (joinReady) void load(joinCode);
          }}
        >
          <h2 className={styles.sectionTitle}>{t(locale, 'challenge.join.heading')}</h2>
          <label className={styles.field}>
            <span className={styles.label}>{t(locale, 'challenge.join.code_label')}</span>
            <input
              className={`${styles.input} ${styles.codeInput}`}
              value={joinCode}
              onChange={(e) => setJoinCode(normalizeChallengeCode(e.target.value))}
              placeholder="A2B3C4D5E6"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={CHALLENGE_CODE_LENGTH}
              enterKeyHint="go"
              aria-label={`${t(locale, 'challenge.join.code_label')}, ${CHALLENGE_CODE_LENGTH}`}
            />
          </label>
          <div className={styles.actions}>
            <Button type="submit" variant="ghost" size="lg" block disabled={busy || !joinReady}>
              <Link2 size={18} aria-hidden />
              {t(locale, 'challenge.join.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
