import { useEffect, useState } from 'react';
import { getLang, setLang, onLangChange } from './i18n.js';

/** Переключатель языка интерфейса: RU | EN */
export default function LangSwitch() {
  const [lang, setL] = useState(getLang());
  useEffect(() => onLangChange(setL), []);
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {[['ru', 'RU', 'Русский'], ['en', 'EN', 'English']].map(([code, label, title]) => (
        <button key={code} className={lang === code ? 'on' : ''} onClick={() => setLang(code)} title={title}>
          {label}
        </button>
      ))}
    </div>
  );
}
