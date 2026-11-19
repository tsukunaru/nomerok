import { useEffect, useState } from 'react';
import type { LanguageSetting, SaveSettings } from '../game/types.ts';
import type { Translations } from '../i18n/types.ts';
import { Icon } from './Icon.tsx';
import { Modal } from './Modal.tsx';

interface SettingsModalProps {
  open: boolean;
  settings: SaveSettings;
  t: Translations;
  canReset: boolean;
  accountAvailable: boolean;
  accountAuthorized: boolean;
  onClose: () => void;
  onSoundChange: (enabled: boolean) => void;
  onMusicChange: (enabled: boolean) => void;
  onTutorial: () => void;
  onLanguageChange: (language: LanguageSetting) => void;
  onReset: () => void;
  onSaveAccount: () => Promise<boolean>;
}

export const SettingsModal = ({
  open,
  settings,
  t,
  canReset,
  accountAvailable,
  accountAuthorized,
  onClose,
  onSoundChange,
  onMusicChange,
  onTutorial,
  onLanguageChange,
  onReset,
  onSaveAccount,
}: SettingsModalProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmOpen(false);
      setAccountMessage('');
    }
  }, [open]);

  const saveAccount = async () => {
    setAccountBusy(true);
    const saved = await onSaveAccount();
    setAccountMessage(saved ? t.accountSaved : t.loginFailed);
    setAccountBusy(false);
  };

  return (
    <>
      <Modal open={open && !confirmOpen} title={t.settings} closeLabel={t.close} onClose={onClose}>
        <div className="settings-list">
          <div className="setting-row">
            <span className="setting-label">{t.music}</span>
            <button className={`switch ${settings.music !== false ? 'is-on' : ''}`} role="switch" aria-label={t.music} aria-checked={settings.music !== false} onClick={() => onMusicChange(settings.music === false)}><span /></button>
          </div>
          <div className="setting-row">
            <span className="setting-label"><Icon name={settings.sound ? 'sound' : 'sound-off'} />{t.sound}</span>
            <button
              className={`switch ${settings.sound ? 'is-on' : ''}`}
              role="switch"
              aria-checked={settings.sound}
              aria-label={t.sound}
              onClick={() => onSoundChange(!settings.sound)}
            ><span /></button>
          </div>
          <div className="setting-block">
            <span className="setting-label">{t.language}</span>
            <div className="segmented-control">
              {([
                ['auto', t.auto],
                ['ru', t.russian],
                ['en', t.english],
              ] as const).map(([value, label]) => (
                <button className={settings.language === value ? 'is-active' : ''} onClick={() => onLanguageChange(value)} key={value}>{label}</button>
              ))}
            </div>
          </div>
          <div className="account-panel">
            <strong>{accountAuthorized ? t.accountSyncing : t.saveAccount}</strong>
            <p>{accountAuthorized ? t.accountSyncingText : t.saveAccountText}</p>
            {!accountAuthorized && <button className="secondary-button" disabled={!accountAvailable || accountBusy} onClick={() => void saveAccount()}>
              <Icon name="gallery" size={20} />{t.saveAccount}
            </button>}
            {accountMessage && <p className="inline-message" role="status">{accountMessage}</p>}
          </div>
          <button className="secondary-button" onClick={onTutorial}>{t.tutorial}</button>
          {canReset && (
            <button className="danger-link" onClick={() => setConfirmOpen(true)}>{t.resetLevel}</button>
          )}
        </div>
      </Modal>
      <Modal open={confirmOpen} title={t.resetTitle} closeLabel={t.close} onClose={() => setConfirmOpen(false)} className="confirm-modal">
        <p className="modal-copy">{t.resetBody}</p>
        <div className="modal-actions">
          <button className="secondary-button" onClick={() => setConfirmOpen(false)}>{t.cancel}</button>
          <button className="danger-button" onClick={() => { onReset(); setConfirmOpen(false); onClose(); }}>{t.reset}</button>
        </div>
      </Modal>
    </>
  );
};
