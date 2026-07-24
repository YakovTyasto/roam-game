import { KeyRound, ArrowLeft, RefreshCw } from 'lucide-react';
import { StatusScreen } from '../components/ui/StatusScreen';
import { Button } from '../components/ui/Button';
import { APP } from '../config/app';
import statusStyles from '../components/ui/StatusScreen.module.css';

interface SetupScreenProps {
  onBack: () => void;
}

export function SetupScreen({ onBack }: SetupScreenProps) {
  return (
    <StatusScreen
      icon={<KeyRound size={26} aria-hidden />}
      title="Add a Google Maps key"
      description={`${APP.name} uses Google Street View for the panorama. Add a browser API key to play. Everything else already works.`}
      actions={
        <>
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={18} aria-hidden />
            Back
          </Button>
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw size={18} aria-hidden />
            I&apos;ve added it — reload
          </Button>
        </>
      }
      note="A browser key is always visible to users. Protect it with HTTP-referrer and API restrictions (see the README), never by hiding it."
    >
      <ol className={statusStyles.steps}>
        <li>
          Create a Google Cloud project and enable the <strong>Maps
          JavaScript API</strong> (billing must be on).
        </li>
        <li>Create an API key and restrict it to your dev + production domains.</li>
        <li>
          Create a file named <code>.env.local</code> in the project root:
        </li>
      </ol>
      <code className={statusStyles.code}>
        VITE_GOOGLE_MAPS_API_KEY=your_key_here
      </code>
      <ol className={statusStyles.steps} start={4}>
        <li>Restart the dev server so Vite picks up the new variable.</li>
      </ol>
    </StatusScreen>
  );
}
