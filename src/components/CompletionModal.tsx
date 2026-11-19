import type { Translations } from '../i18n/types.ts';
import { Icon } from './Icon.tsx';
import { Modal } from './Modal.tsx';

export const CompletionModal = ({
  open,
  t,
  hasNext,
  onNext,
  onHome,
}: {
  open: boolean;
  t: Translations;
  hasNext: boolean;
  onNext: () => void;
  onHome: () => void;
}) => (
  <Modal open={open} title={t.completionTitle} closeLabel={t.allPictures} onClose={onHome} className="completion-modal">
    <div className="completion-emblem"><Icon name="sparkles" size={44} /></div>
    <p className="modal-copy">{t.completionText}</p>
    <div className="modal-actions stacked">
      {hasNext && <button className="primary-button" onClick={onNext}>{t.nextLevel}</button>}
      <button className="secondary-button" onClick={onHome}><Icon name="gallery" size={20} />{t.allPictures}</button>
    </div>
  </Modal>
);
