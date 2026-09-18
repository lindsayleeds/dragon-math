import { useState } from 'react';
import styles from '../styles/DragonPhonics.module.css';
import { ELEMENT_BY_KEY } from '../data/phonicsCurriculum';
// LEVEL_INFO lives with the rollup helpers rather than here: a file that exports
// components may only export components, or react-refresh loses its fast-refresh
// boundary (react-refresh/only-export-components).
import { LEVEL_INFO, fullMastery, stageSummary, overallSummary } from '../hooks/usePhonicsProgress';
import { speakSoundInWord } from '../utils/speakSound';

/**
 * The Sound Map: every sound in the program, coloured by how well the child
 * knows it.
 *
 * This is the "comprehensively understands phonics" screen, so it shows the
 * WHOLE curriculum including sounds never attempted — a map of only what has
 * been practiced would make a child who has played one stage look finished.
 *
 * @param {object} props
 * @param {object|null} props.mastery   `report.elements` from GET /api/phonics/mastery
 * @param {Array} [props.confusions]    mixed-up pairs from the same report
 * @param {(stage:number)=>void} [props.onPractiseStage]
 * @param {boolean} [props.compact]     drop the headline (the parent view has its own)
 */
export function PhonicsMasteryMap({ mastery, confusions = [], onPractiseStage, compact = false }) {
  const [selected, setSelected] = useState(null);
  const full = fullMastery(mastery);
  const stages = stageSummary(mastery);
  const overall = overallSummary(mastery);

  const selectedEl = selected ? ELEMENT_BY_KEY[selected] : null;
  const selectedState = selected ? full[selected] : null;

  return (
    <div className={styles.mapWrap}>
      {!compact && (
        <div className={styles.mapHeadline}>
          <div className={styles.mapBigNumber}>
            {overall.mastered}<span className={styles.mapOf}>/{overall.total}</span>
          </div>
          <div className={styles.mapHeadlineText}>
            <strong>sounds mastered</strong>
            <span className={styles.mapSubtle}>
              {overall.solid > 0 && `${overall.solid} nearly there · `}
              {overall.learning > 0 && `${overall.learning} still learning · `}
              {overall.new} not tried yet
            </span>
            {overall.stale > 0 && (
              <span className={styles.mapStale}>
                🔁 {overall.stale} {overall.stale === 1 ? 'sound needs' : 'sounds need'} a re-check
              </span>
            )}
          </div>
        </div>
      )}

      <Legend />

      {stages.map((stage) => (
        <section key={stage.key} className={styles.mapStage}>
          <header className={styles.mapStageHead}>
            <span className={styles.mapStageEmoji} aria-hidden>{stage.emoji}</span>
            <div className={styles.mapStageTitles}>
              <h3 className={styles.mapStageName}>{stage.label}</h3>
              <p className={styles.mapStageBlurb}>{stage.blurb}</p>
            </div>
            <span className={styles.mapStageScore}>
              {stage.mastered}/{stage.total}
            </span>
          </header>

          <div className={styles.mapStageBar} aria-hidden>
            <div className={styles.mapStageFill} style={{ width: `${stage.percent}%` }} />
          </div>

          <div className={styles.tileGrid} role="list">
            {stage.elements.map((key) => {
              const state = full[key];
              const el = ELEMENT_BY_KEY[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="listitem"
                  className={`${styles.tile} ${styles[`tile_${state.level}`]} ${selected === key ? styles.tileOn : ''}`}
                  onClick={() => {
                    setSelected(selected === key ? null : key);
                    if (selected !== key) speakSoundInWord(el, el.words[0]);
                  }}
                  aria-label={`${el.g}, ${el.sound}, ${LEVEL_INFO[state.level].label}${state.stale ? ', needs a re-check' : ''}`}
                >
                  <span className={styles.tileLetters}>{el.g}</span>
                  {state.stale && <span className={styles.tileStale} aria-hidden>🔁</span>}
                </button>
              );
            })}
          </div>

          {onPractiseStage && (
            <button
              type="button"
              className={styles.mapStageBtn}
              onClick={() => onPractiseStage(stage.stage)}
            >
              Practise {stage.label} →
            </button>
          )}
        </section>
      ))}

      {selectedEl && selectedState && (
        <ElementDetail element={selectedEl} state={selectedState} onClose={() => setSelected(null)} />
      )}

      {confusions.length > 0 && <Confusions confusions={confusions} />}
    </div>
  );
}

function Legend() {
  return (
    <div className={styles.legend} role="list" aria-label="What the colours mean">
      {['new', 'learning', 'solid', 'mastered'].map((level) => (
        <span key={level} role="listitem" className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles[`tile_${level}`]}`} aria-hidden />
          {LEVEL_INFO[level].short}
        </span>
      ))}
    </div>
  );
}

// A tapped tile opens the one thing the map cannot show at a glance: why this
// sound sits where it does, and what would move it.
function ElementDetail({ element, state, onClose }) {
  const info = LEVEL_INFO[state.level];
  return (
    <div className={styles.detailCard}>
      <button type="button" className={styles.detailClose} onClick={onClose} aria-label="Close">×</button>
      <div className={styles.detailHead}>
        <span className={styles.detailLetters}>{element.g}</span>
        <span className={styles.detailSound}>{element.sound}</span>
      </div>
      <p className={styles.detailLevel}>
        <span aria-hidden>{info.emoji}</span> {info.label}
      </p>
      <p className={styles.detailHint}>{info.hint}</p>
      {element.note && <p className={styles.detailNote}>{element.note}</p>}
      <p className={styles.detailWords}>
        as in {element.words.map((w, i) => (
          <span key={w}>{i > 0 && ', '}<strong>{w}</strong></span>
        ))}
      </p>
      {state.attempts > 0 && (
        <p className={styles.detailStats}>
          {state.correct} right out of your last {state.attempts}
          {state.modes.length > 0 && ` · right in ${state.modes.length} ${state.modes.length === 1 ? 'game' : 'games'}`}
        </p>
      )}
      <button
        type="button"
        className={styles.hintBtn}
        onClick={() => speakSoundInWord(element, element.words[0])}
      >
        🔊 hear it
      </button>
    </div>
  );
}

// Mixed-up pairs. Named in both directions ("you read /sh/ as /ch/") because the
// useful fact is the confusion, not the error count.
function Confusions({ confusions }) {
  const known = confusions
    .map((c) => ({ ...c, a: ELEMENT_BY_KEY[c.element], b: ELEMENT_BY_KEY[c.chose] }))
    .filter((c) => c.a && c.b);
  if (!known.length) return null;

  return (
    <section className={styles.confusions}>
      <h3 className={styles.confusionTitle}>Sounds that get mixed up</h3>
      <ul className={styles.confusionList}>
        {known.map((c) => (
          <li key={`${c.element}-${c.chose}`} className={styles.confusionRow}>
            <span className={styles.confusionPair}>
              <strong>{c.a.g}</strong> {c.a.sound}
              <span className={styles.confusionArrow} aria-hidden>→</span>
              <strong>{c.b.g}</strong> {c.b.sound}
            </span>
            <span className={styles.confusionCount}>{c.count}×</span>
          </li>
        ))}
      </ul>
      <p className={styles.confusionNote}>
        These pairs sound alike. Hearing them right next to each other is the fastest way to split them apart.
      </p>
    </section>
  );
}
