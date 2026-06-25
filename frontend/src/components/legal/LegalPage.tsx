import Link from 'next/link';
import { ArrowLeft, Bird, Mail, MapPin } from 'lucide-react';

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  children?: { title: string; paragraphs?: string[]; bullets?: string[] }[];
};

export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string[]; sections: LegalSection[] }) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/login" className="flex items-center gap-2 font-semibold text-slate-950">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white"><Bird className="h-5 w-5" /></span>
            Digital AdBird
          </Link>
          <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-blue-600">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="border-b border-slate-200 pb-8">
          <p className="text-sm font-medium text-blue-600">Digital AdBird Legal</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-slate-500">Last updated: {updated}</p>
          <div className="mt-6 space-y-4 text-base leading-7 text-slate-700">
            {intro.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </div>

        <article className="space-y-9 py-9">
          {sections.map((section, index) => (
            <section key={section.title} id={`section-${index + 1}`} className="scroll-mt-20">
              <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
              <TextBlocks paragraphs={section.paragraphs} bullets={section.bullets} />
              {section.children?.map(child => (
                <div key={child.title} className="mt-6">
                  <h3 className="text-base font-semibold text-slate-900">{child.title}</h3>
                  <TextBlocks paragraphs={child.paragraphs} bullets={child.bullets} />
                </div>
              ))}
            </section>
          ))}
        </article>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-950">Digital AdBird</h2>
          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            <p className="flex items-start gap-2"><MapPin className="mt-1 h-4 w-4 shrink-0" />3rd Floor, 4/18 Manoj Yadav Building, Saraswati Puram, Khargapur, Gomti Nagar, Lucknow, Uttar Pradesh, India - 226010</p>
            <a href="mailto:support@digitaladbird.com" className="flex items-center gap-2 hover:text-blue-600"><Mail className="h-4 w-4" />support@digitaladbird.com</a>
            <a href="https://www.crm.digitaladbird.com" target="_blank" rel="noopener noreferrer" className="inline-block font-medium text-blue-600 hover:text-blue-700">www.crm.digitaladbird.com</a>
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <span>Copyright {new Date().getFullYear()} Digital AdBird</span>
          <nav className="flex gap-4"><Link href="/privacy-policy" className="hover:text-blue-600">Privacy Policy</Link><Link href="/terms" className="hover:text-blue-600">Terms and Conditions</Link></nav>
        </footer>
      </div>
    </main>
  );
}

function TextBlocks({ paragraphs, bullets }: { paragraphs?: string[]; bullets?: string[] }) {
  return <div className="mt-3 space-y-3 text-[15px] leading-7 text-slate-700">
    {paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
    {bullets?.length ? <ul className="list-disc space-y-2 pl-6 marker:text-slate-400">{bullets.map(item => <li key={item}>{item}</li>)}</ul> : null}
  </div>;
}
