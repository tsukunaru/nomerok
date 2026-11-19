import { useState } from 'react';
import type { Translations } from '../i18n/types.ts';
import { Modal } from './Modal.tsx';

export const Tutorial = ({ t, onFinish }: { t: Translations; onFinish: () => void }) => {
  const [step, setStep] = useState(0);
  const current = t.tutorialSteps[step];
  return <Modal open title={`${t.tutorial} · ${step + 1}/${t.tutorialSteps.length}`} closeLabel={t.tutorialSkip} onClose={onFinish} className="tutorial-modal">
    <div className="tutorial-demo" aria-hidden="true">{['1  2  3', '2  ▧  2', '−  ⤢  +', '✧', '▶  +10', '✓'][step]}</div>
    <h3>{current.title}</h3><p className="modal-copy">{current.text}</p>
    <div className="modal-actions">
      <button className="secondary-button" onClick={onFinish}>{t.tutorialSkip}</button>
      <button className="primary-button" onClick={() => step + 1 === t.tutorialSteps.length ? onFinish() : setStep(step + 1)}>{step + 1 === t.tutorialSteps.length ? t.tutorialFinish : t.tutorialNext}</button>
    </div>
  </Modal>;
};
