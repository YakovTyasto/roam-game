import { KeyRound, Users, AlertTriangle, RotateCcw, ArrowLeft, Home } from 'lucide-react';
import type { Preferences } from '../../types';
import { APP } from '../../config/app';
import { StatusScreen } from '../../components/ui/StatusScreen';
import { Button } from '../../components/ui/Button';
import { LoadingOverlay } from '../../components/ui/LoadingOverlay';
import { useMultiplayer } from '../../multiplayer/useMultiplayer';
import { MultiplayerMenu } from './MultiplayerMenu';
import { Lobby } from './Lobby';
import { MultiplayerGame } from './MultiplayerGame';
import { MultiplayerFinal } from './MultiplayerFinal';
import statusStyles from '../../components/ui/StatusScreen.module.css';

interface MultiplayerAppProps {
  initialCode: string;
  units: Preferences['units'];
  playerName: string;
  onExitHome: () => void;
}

export function MultiplayerApp({
  initialCode,
  units,
  playerName,
  onExitHome,
}: MultiplayerAppProps) {
  const mp = useMultiplayer(initialCode);
  const { status, view, room, snapshot } = mp;

  if (status === 'config-missing') {
    return (
      <StatusScreen
        icon={<Users size={26} aria-hidden />}
        title="Multiplayer isn’t set up yet"
        description={`Private multiplayer needs a Supabase project. Solo ${APP.name} works without it.`}
        actions={
          <Button variant="ghost" onClick={onExitHome}>
            <ArrowLeft size={18} aria-hidden />
            Back to home
          </Button>
        }
        note="Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your environment. See docs/MULTIPLAYER_SETUP.md for the full walkthrough."
      >
        <ol className={statusStyles.steps}>
          <li>Create a free Supabase project and enable anonymous sign-ins.</li>
          <li>Apply the SQL migration in <code>supabase/migrations</code>.</li>
          <li>
            Add the two <code>VITE_SUPABASE_*</code> variables to <code>.env.local</code>.
          </li>
        </ol>
      </StatusScreen>
    );
  }

  if (status === 'needs-maps-key') {
    return (
      <StatusScreen
        icon={<KeyRound size={26} aria-hidden />}
        title="Add a Google Maps key"
        description="Multiplayer uses Street View for the panorama, so it needs the same Google Maps key as solo play."
        actions={
          <Button variant="ghost" onClick={onExitHome}>
            <ArrowLeft size={18} aria-hidden />
            Back to home
          </Button>
        }
        note="A browser key is always visible to users — protect it with HTTP-referrer and API restrictions, never by hiding it."
      >
        <ol className={statusStyles.steps}>
          <li>
            Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to <code>.env.local</code>.
          </li>
          <li>Restart the dev server so Vite picks it up.</li>
        </ol>
      </StatusScreen>
    );
  }

  if (status === 'authenticating') {
    return (
      <div style={{ position: 'relative', minHeight: '100dvh' }}>
        <LoadingOverlay label="Connecting to multiplayer…" />
      </div>
    );
  }

  if (status === 'error') {
    // Either a fatal auth error, or an in-room error (opponent left, expired…).
    const message = mp.authError ?? view?.errorReason ?? 'Something went wrong.';
    const isAuth = mp.authError !== null;
    return (
      <StatusScreen
        tone="danger"
        icon={<AlertTriangle size={26} aria-hidden />}
        title={isAuth ? 'Couldn’t connect' : 'Match ended'}
        description={message}
        actions={
          <>
            {isAuth && (
              <Button variant="primary" onClick={mp.actions.retryAuth}>
                <RotateCcw size={18} aria-hidden />
                Try again
              </Button>
            )}
            <Button
              variant={isAuth ? 'ghost' : 'primary'}
              onClick={() => {
                void mp.actions.leaveRoom();
                onExitHome();
              }}
            >
              <Home size={18} aria-hidden />
              Back to home
            </Button>
          </>
        }
      />
    );
  }

  if (status === 'reconnecting') {
    return (
      <div style={{ position: 'relative', minHeight: '100dvh' }}>
        <LoadingOverlay label="Joining room…" />
      </div>
    );
  }

  if (status === 'menu' || status === 'creating' || status === 'joining') {
    return (
      <MultiplayerMenu
        initialCode={initialCode}
        playerName={playerName}
        busy={mp.busy || status !== 'menu'}
        error={mp.menuError}
        onCreate={(options) => mp.actions.createRoom(playerName, options)}
        onJoin={(code) => mp.actions.joinRoom(code, playerName)}
        onClearError={mp.actions.clearMenuError}
        onBack={onExitHome}
      />
    );
  }

  // From here on we require a room + view.
  if (!room || !view) {
    return (
      <div style={{ position: 'relative', minHeight: '100dvh' }}>
        <LoadingOverlay label="Loading…" />
      </div>
    );
  }

  if (status === 'lobby') {
    return (
      <Lobby
        room={room}
        view={view}
        onlineUserIds={mp.onlineUserIds}
        busy={mp.busy}
        notice={mp.notice}
        onStart={mp.actions.startMatch}
        onLeave={mp.actions.leaveRoom}
      />
    );
  }

  if (status === 'final') {
    if (!snapshot) {
      return (
        <div style={{ position: 'relative', minHeight: '100dvh' }}>
          <LoadingOverlay label="Tallying scores…" />
        </div>
      );
    }
    return (
      <MultiplayerFinal
        view={view}
        snapshot={snapshot}
        units={units}
        busy={mp.busy}
        notice={mp.notice}
        onRematch={mp.actions.rematch}
        onHome={() => {
          void mp.actions.leaveRoom();
          onExitHome();
        }}
      />
    );
  }

  // active | submitted | round-result
  return (
    <MultiplayerGame
      room={room}
      view={view}
      secondsLeft={mp.secondsLeft}
      onlineUserIds={mp.onlineUserIds}
      connection={mp.connection}
      busy={mp.busy}
      units={units}
      onSubmitGuess={mp.actions.submitGuess}
      onAdvance={mp.actions.advance}
      onLeave={mp.actions.leaveRoom}
    />
  );
}
