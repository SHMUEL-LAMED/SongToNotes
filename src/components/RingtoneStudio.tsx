import { ArrowRight, Music2 } from "lucide-react";
type Props = { onBack: () => void };
export function RingtoneStudio({ onBack }: Props) {
  return <main className="ringtone-page">
    <nav className="topbar"><button className="brand brand-button" onClick={onBack} type="button"><span className="brand-mark"><Music2 size={22} /></span><span>כלי מוזיקה</span></button><button className="back-button" onClick={onBack} type="button"><ArrowRight size={18} /> כל האפשרויות</button></nav>
    <section className="advanced-ringtone"><iframe title="יצירת צלצולים" src="https://shmuel-lamed.github.io/Ringtones/" /></section>
  </main>;
}