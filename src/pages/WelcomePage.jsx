import { ArrowRight, Upload, ChevronRight } from 'lucide-react'
import { useStore } from '../hooks/useStore'
import { useLang } from '../hooks/useLang'
import s from './WelcomePage.module.css'

export default function WelcomePage() {
  const { goTo } = useStore()
  const { t, lang } = useLang()

  const steps = [
    { num:1, icon:'🧬', label:t.steps.panel,   desc:lang==='tr'?'Gen paneli seç':'Select gene panel' },
    { num:2, icon:'👥', label:t.steps.samples,  desc:lang==='tr'?'Hasta listesi':'Patient list' },
    { num:3, icon:'⚙️', label:t.steps.run,      desc:lang==='tr'?'Analizi başlat':'Start analysis' },
    { num:4, icon:'📊', label:t.steps.results,  desc:lang==='tr'?'Bulguları incele':'Review findings' },
  ]

  return (
    <div className={s.page}>
      <div className={s.bg}>
        <div className={s.bgGrid} />
        <div className={s.bgGlow1} />
        <div className={s.bgGlow2} />
        <div className={s.bgGlow3} />
      </div>

      <div className={s.content}>
        <div className={s.badge}>
          <span className={s.badgeDot} />
          <span>{lang==='tr'?'Klinik Karar Destek Sistemi':'Clinical Decision Support'}</span>
        </div>

        <h1 className={s.title}>
          <span>CNV</span><span className={s.titleAccent}>Detect</span>
        </h1>

        <p className={s.subtitle}>{t.welcome.subtitle}</p>

        <div className={s.cta}>
          <button className={s.primaryBtn} onClick={()=>goTo(1)}>
            <span>{t.welcome.start}</span>
            <ArrowRight size={18} strokeWidth={2.5}/>
          </button>
          <button className={s.secondaryBtn} onClick={()=>goTo(4)}>
            <Upload size={15} strokeWidth={1.8}/>
            <span>{t.welcome.load}</span>
          </button>
        </div>

        <div className={s.flow}>
          {steps.map((step,i)=>(
            <div key={step.num} className={s.flowGroup}>
              <div className={s.flowCard} onClick={()=>goTo(step.num)}>
                <div className={s.flowTop}>
                  <span className={s.flowNum}>{step.num}</span>
                  <span className={s.flowIcon}>{step.icon}</span>
                </div>
                <div className={s.flowLabel}>{step.label}</div>
                <div className={s.flowDesc}>{step.desc}</div>
              </div>
              {i<steps.length-1&&<ChevronRight size={18} className={s.flowArrow}/>}
            </div>
          ))}
        </div>

        <p className={s.note}>
          {lang==='tr'
            ?'Hedef panel sekanslamasından kopya sayısı değişikliklerini tespit eden profesyonel analiz aracı'
            :'Professional tool for detecting copy number changes from targeted panel sequencing'}
        </p>
      </div>
    </div>
  )
}
