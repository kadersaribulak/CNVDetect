import { createContext, useContext, useState } from 'react'
import { translations } from '../i18n/translations'

const LangCtx = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('cnvdetect_lang') || 'tr')

  const t = translations[lang]

  const switchLang = (l) => {
    setLang(l)
    localStorage.setItem('cnvdetect_lang', l)
  }

  return (
    <LangCtx.Provider value={{ lang, t, switchLang }}>
      {children}
    </LangCtx.Provider>
  )
}

export const useLang = () => useContext(LangCtx)
