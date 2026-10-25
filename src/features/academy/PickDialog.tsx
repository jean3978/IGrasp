// The pick of a card that needs one: the feature of a Deep Dive, the action of a Trace It.

import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import type { TutorialSubject } from '../../ipc/types';

export function PickDialog({
  card,
  onClose,
  onPick,
}: {
  card: TutorialSubject | null;
  onClose: () => void;
  onPick: (card: TutorialSubject, pick: string) => void;
}) {
  return (
    <Dialog.Root
      open={card !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        {card && (
          <Dialog.Content className="dialog academy-pick-dialog" aria-describedby={undefined}>
            <Dialog.Close className="dialog-close" aria-label="Close">
              <X aria-hidden />
            </Dialog.Close>
            <Dialog.Title className="dialog-title">{card.title}</Dialog.Title>
            <p className="quiz-muted">
              {card.family === 'Trace It' ? 'Which action?' : 'Which one?'}
            </p>
            <ul className="academy-pick-list">
              {card.picks.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="academy-pick"
                    onClick={() => {
                      onPick(card, p.title);
                    }}
                  >
                    <span className="academy-pick-title">{p.title}</span>
                    <span className="quiz-muted">{p.anchors.slice(0, 3).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
