import { useEffect } from 'react';
import { gamesForSkill } from '../data/games';
import styles from '../styles/GameChoiceModal.module.css';

/**
 * GameChoiceModal
 *
 * Displays a parchment-styled modal for a child to choose which game to play.
 * The modal shows available game options with icons, names, and descriptions.
 *
 * @param {Object} props
 * @param {string} props.operation - The math operation (e.g., 'mul')
 * @param {number} props.number - The number being practiced (e.g., 3)
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {Function} props.onClose - Called when the modal should close
 * @param {Function} props.onSelectGame - Called with gameName when a game is selected
 */
export function GameChoiceModal({
  operation,
  number,
  isOpen,
  onClose,
  onSelectGame,
}) {
  // Handle Escape key to close modal
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    if (isOpen) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Only offer games that can actually practice this skill.
  const games = gamesForSkill(operation);

  const handleGameSelect = (gameId) => {
    // Just select the game; the parent closes the modal by transitioning
    // state (selectedGameType becomes set, so isOpen turns false). Calling
    // onClose here would reset that selection and reopen the chooser.
    onSelectGame?.(gameId);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>

        <h2 className={styles.title}>Choose a game</h2>

        <div className={styles.gameGrid}>
          {games.map(game => (
            <button
              key={game.id}
              type="button"
              className={styles.gameCard}
              onClick={() => handleGameSelect(game.id)}
              title={game.description}
            >
              <div className={styles.gameEmoji}>{game.emoji}</div>
              <h3 className={styles.gameName}>{game.name}</h3>
              <p className={styles.gameDescription}>{game.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
