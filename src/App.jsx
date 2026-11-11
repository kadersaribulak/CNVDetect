import { Dna, Globe } from 'lucide-react'
import { StoreProvider, useStore } from './hooks/useStore'
import { LangProvider, useLang } from './hooks/useLang'
import WelcomePage  from './pages/WelcomePage'
import PanelPage    from './pages/PanelPage'
import SamplesPage  from './pages/SamplesPage'
import RunPage      from './pages/RunPage'
import ResultsPage  from './pages/ResultsPage'
import s from './App.module.css'

export default function App() {
  return (
    <LangProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </LangProvider>
  )
}

function Shell() {
  const { step, goTo } = useStore()
  const { t, lang, switchLang } = useLang()

  const STEPS = [t.steps.panel, t.steps.samples, t.steps.run, t.steps.results]

  return (
    <div className={s.shell}>
      {/* Top bar */}
      <header className={s.topbar}>
        <div className={s.topbarBrand} onClick={() => goTo(0)} style={{cursor:'pointer'}}>
          <div className={s.brandIcon}><Dna size={16} strokeWidth={2} /></div>
          <span className={s.brandName}>{t.appName}</span>
        </div>

        {/* Step progress — only when in wizard */}
        {step > 0 && (
          <nav className={s.progress}>
            {STEPS.map((label, i) => {
              const num = i + 1
              const active = step === num
              const done   = step > num
              return (
                <div key={i} className={`${s.progressItem} ${active?s.pActive:''} ${done?s.pDone:''}`}>
                  <div className={s.progressDot}>
                    {done ? '✓' : num}
                  </div>
                  <span className={s.progressLabel}>{label}</span>
                  {i < STEPS.length - 1 && <div className={s.progressLine} />}
                </div>
              )
            })}
          </nav>
        )}

        {/* Language switcher */}
        <div className={s.langSwitch}>
          <Globe size={14} className={s.langIcon} />
          <button className={`${s.langBtn} ${lang==='tr'?s.langActive:''}`} onClick={()=>switchLang('tr')}>TR</button>
          <span className={s.langSep}>|</span>
          <button className={`${s.langBtn} ${lang==='en'?s.langActive:''}`} onClick={()=>switchLang('en')}>EN</button>
        </div>
      </header>

      {/* Page content */}
      <main className={s.main}>
        {step === 0 && <WelcomePage />}
        {step === 1 && <PanelPage />}
        {step === 2 && <SamplesPage />}
        {step === 3 && <RunPage />}
        {step === 4 && <ResultsPage />}
      </main>
    </div>
  )
}
