import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragonPhonics } from '../components/DragonPhonics';
import { PhonicsGame } from '../components/PhonicsGame';
import { PhonicsMasteryMap } from '../components/PhonicsMasteryMap';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { usePhonicsProgress, stageSummary, overallSummary } from '../hooks/usePhonicsProgress';
import { PHONICS_MODES, MODE_BY_KEY, reviewTargets } from '../data/phonicsRounds';
import { PHONICS_LEVELS } from '../data/phonicsWords';
import styles from '../styles/DragonPhonics.module.css';

// Dragon Phonics' hub. Two tabs, because the program is two things: a set of
// games, and a picture of what the child knows. The picture is not buried in a
// grown-up's dashboard — a child who can see which sounds are still grey works
// on those sounds, and the Sound Map is the only screen that shows the whole
// curriculum at once.
//
// The flow is mode → stage → play, in that order. Mode first because the modes
// are genuinely different tasks (tap / type / hunt) and a child has a preference;
// stage second because every mode can ask about every stage.

const TABS = [
  { key: 'play', label: 'Play', emoji: '🎧' },
  { key: 'map', label: 'My Sounds', emoji: '🗺️' },
];

// `missing-sound` keeps its own three levels rather than the eight stages —
// its word frames are hand-segmented and don't line up with the curriculum. It
// still records progress against the same elements (see curriculumKeyFor).
const LEGACY_MODE = 'missing-sound';

export function DragonPhonicsPage() {
  const navigate = useNavigate();
  usePlaytimeHeartbeat(true);

  const { mastery, confusions, loading, save } = usePhonicsProgress();

  const [tab, setTab] = useState('play');
  const [mode, setMode] = useState(null);
  const [stage, setStage] = useState(null);      // number | 'all' | 'review'
  const [legacyLevel, setLegacyLevel] = useState(null);
  const [playing, setPlaying] = useState(false);

  const stages = useMemo(() => stageSummary(mastery), [mastery]);
  const overall = useMemo(() => overallSummary(mastery), [mastery]);
  const review = useMemo(() => reviewTargets(mastery), [mastery]);

  const exitToPicker = () => {
    setPlaying(false);
    setStage(null);
    setLegacyLevel(null);
  };

  // ---------------------------------------------------------------- playing
  if (playing && mode === LEGACY_MODE && legacyLevel) {
    return <DragonPhonics level={legacyLevel} onComplete={exitToPicker} onSave={save} />;
  }

  if (playing && mode && stage != null) {
    return (
      <PhonicsGame
        mode={mode}
        stages={stage === 'review' ? 'all' : stage}
        only={stage === 'review' ? review : null}
        mastery={mastery}
        onSave={save}
        onExit={exitToPicker}
      />
    );
  }

  // ---------------------------------------------------------------- picker
  const modeInfo = mode ? MODE_BY_KEY[mode] : null;
  const canStart = mode === LEGACY_MODE ? !!legacyLevel : !!mode && stage != null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          className={styles.backTab}
          onClick={() => (mode ? setMode(null) : navigate('/learning-lair'))}
        >
          {mode ? '← back' : '← back'}
        </button>
        <h1 className={styles.title}>
          <span className={styles.titleIcon} aria-hidden>🐲</span>
          Dragon Phonics
        </h1>
        <p className={styles.subtitle}>
          {loading
            ? 'loading your sounds…'
            : `${overall.mastered} of ${overall.total} sounds mastered`}
        </p>
      </header>

      <div className={styles.tabRow} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`${styles.tabBtn} ${tab === t.key ? styles.tabBtnOn : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span aria-hidden>{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>

      <main className={styles.pickerMain}>
        {tab === 'map' ? (
          <PhonicsMasteryMap
            mastery={mastery}
            confusions={confusions}
            onPractiseStage={(n) => {
              setTab('play');
              setMode((m) => (m && m !== LEGACY_MODE ? m : 'choose'));
              setStage(n);
            }}
          />
        ) : !mode ? (
          <section className={styles.pickerSection}>
            <h2 className={styles.pickerHeading}>Pick a game</h2>
            <div className={styles.levelGrid}>
              {PHONICS_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={styles.levelCard}
                  onClick={() => {
                    setMode(m.key);
                    setStage(null);
                    setLegacyLevel(null);
                  }}
                >
                  <span className={styles.levelEmoji} aria-hidden>{m.emoji}</span>
                  <span className={styles.levelLabel}>
                    {m.name}
                    <span className={`${styles.diffPill} ${styles[`diff_${m.difficulty}`]}`}>
                      {m.difficulty}
                    </span>
                  </span>
                  <span className={styles.levelBlurb}>{m.blurb}</span>
                </button>
              ))}
            </div>
            <p className={styles.modeNote}>
              A sound counts as <strong>mastered</strong> once you get it right in
              two different games — so it is worth playing more than one.
            </p>
          </section>
        ) : mode === LEGACY_MODE ? (
          <section className={styles.pickerSection}>
            <h2 className={styles.pickerHeading}>{modeInfo.name}</h2>
            <p className={styles.pickerBlurb}>{modeInfo.blurb}</p>
            <div className={styles.levelGrid}>
              {PHONICS_LEVELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`${styles.levelCard} ${legacyLevel === l.key ? styles.levelCardActive : ''}`}
                  onClick={() => setLegacyLevel(l.key)}
                >
                  <span className={styles.levelEmoji} aria-hidden>{l.emoji}</span>
                  <span className={styles.levelLabel}>{l.label}</span>
                  <span className={styles.levelBlurb}>{l.blurb}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className={styles.pickerSection}>
            <h2 className={styles.pickerHeading}>{modeInfo.name}</h2>
            <p className={styles.pickerBlurb}>{modeInfo.blurb}</p>

            <div className={styles.stagePickGrid}>
              {review && (
                <button
                  type="button"
                  className={`${styles.stagePick} ${styles.stagePickReview} ${stage === 'review' ? styles.stagePickOn : ''}`}
                  onClick={() => setStage('review')}
                >
                  <span className={styles.stagePickEmoji} aria-hidden>🔁</span>
                  <span className={styles.stagePickName}>Needs Practice</span>
                  <span className={styles.stagePickMeta}>{review.length} sounds</span>
                </button>
              )}
              <button
                type="button"
                className={`${styles.stagePick} ${stage === 'all' ? styles.stagePickOn : ''}`}
                onClick={() => setStage('all')}
              >
                <span className={styles.stagePickEmoji} aria-hidden>🌍</span>
                <span className={styles.stagePickName}>Everything</span>
                <span className={styles.stagePickMeta}>all {overall.total} sounds</span>
              </button>

              {stages.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`${styles.stagePick} ${stage === s.stage ? styles.stagePickOn : ''}`}
                  onClick={() => setStage(s.stage)}
                >
                  <span className={styles.stagePickEmoji} aria-hidden>{s.emoji}</span>
                  <span className={styles.stagePickName}>{s.label}</span>
                  <span className={styles.stagePickMeta}>{s.mastered}/{s.total} mastered</span>
                  <span className={styles.stagePickBar} aria-hidden>
                    <span className={styles.stagePickFill} style={{ width: `${s.percent}%` }} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === 'play' && mode && (
          <button
            type="button"
            className={styles.startBtn}
            disabled={!canStart}
            onClick={() => setPlaying(true)}
          >
            Start listening →
          </button>
        )}
      </main>
    </div>
  );
}
