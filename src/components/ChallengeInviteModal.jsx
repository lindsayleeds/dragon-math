import { useEffect, useState } from 'react';
import { useRealtime } from '../contexts/RealtimeContext';
import { renderAvatar } from '../utils/avatar';
import styles from '../styles/ChallengeInviteModal.module.css';

const CHALLENGE_TTL_S = 30;

// Global challenge UI: an accept/decline modal for an incoming math race, plus a
// small waiting toast for a challenge you sent. Rendered once at the app root so
// it surfaces over any page.
export function ChallengeInviteModal() {
  const rt = useRealtime();
  if (!rt) return null;
  const { incomingChallenge, outgoingChallenge, respondChallenge, cancelChallenge, clearOutgoing } = rt;

  return (
    <>
      {incomingChallenge && (
        <IncomingCard
          challenge={incomingChallenge}
          onAccept={() => respondChallenge(incomingChallenge.challengeId, true)}
          onDecline={() => respondChallenge(incomingChallenge.challengeId, false)}
        />
      )}
      {outgoingChallenge && (
        <OutgoingToast
          challenge={outgoingChallenge}
          onCancel={() => cancelChallenge(outgoingChallenge.challengeId)}
          onDismiss={clearOutgoing}
        />
      )}
    </>
  );
}

function IncomingCard({ challenge, onAccept, onDecline }) {
  const [secondsLeft, setSecondsLeft] = useState(CHALLENGE_TTL_S);

  useEffect(() => {
    setSecondsLeft(CHALLENGE_TTL_S);
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [challenge.challengeId]);

  const name = challenge.fromUsername || 'A friend';
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.icon}>{renderAvatar(challenge.fromAvatar) || '⚔️'}</div>
        <h2 className={styles.title}>{name} wants a math race!</h2>
        <p className={styles.sub}>First to 10 correct answers wins. Ready?</p>
        <p className={styles.countdown}>expires in {secondsLeft}s</p>
        <div className={styles.buttons}>
          <button type="button" className={`${styles.btn} ${styles.decline}`} onClick={onDecline}>
            No thanks
          </button>
          <button type="button" className={`${styles.btn} ${styles.accept}`} onClick={onAccept}>
            Let’s race!
          </button>
        </div>
      </div>
    </div>
  );
}

function OutgoingToast({ challenge, onCancel, onDismiss }) {
  // Auto-dismiss the terminal states after a moment.
  useEffect(() => {
    if (challenge.status === 'waiting') return undefined;
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [challenge.status, onDismiss]);

  if (challenge.status === 'waiting') {
    return (
      <div className={styles.toast}>
        <span>⚔️ Waiting for your friend to accept…</span>
        <button type="button" className={styles.toastBtn} onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  const message = {
    declined: 'Your friend passed on the race.',
    expired: 'No answer — the challenge expired.',
    unavailable: 'That friend isn’t available right now.',
  }[challenge.status] || 'Challenge ended.';

  return (
    <div className={styles.toast}>
      <span>{message}</span>
      <button type="button" className={styles.toastBtn} onClick={onDismiss}>OK</button>
    </div>
  );
}
