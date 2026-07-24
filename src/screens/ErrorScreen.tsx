import { AlertTriangle, RotateCcw } from 'lucide-react';
import { StatusScreen } from '../components/ui/StatusScreen';
import { Button } from '../components/ui/Button';

interface ErrorScreenProps {
  message: string | null;
  onDismiss: () => void;
}

export function ErrorScreen({ message, onDismiss }: ErrorScreenProps) {
  return (
    <StatusScreen
      tone="danger"
      icon={<AlertTriangle size={26} aria-hidden />}
      title="Something went wrong"
      description={
        message ??
        'We hit an unexpected problem loading this round. Please try again.'
      }
      actions={
        <Button variant="primary" onClick={onDismiss}>
          <RotateCcw size={18} aria-hidden />
          Back to start
        </Button>
      }
    />
  );
}
