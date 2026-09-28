'use client';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {BookOpen,Clock3,Search} from 'lucide-react';
import {AppShell} from '@/components/layout/AppShell';
import {apiGet} from '@/lib/api';
import {useAuth} from '@/lib/auth';

export interface GuideCard {
  status:string;code:string;label:string;meaning:string;category:string;automaticAging:boolean;
  first:string;second:string;special:string|null;steps:string[];
}
interface GuideResponse {enabled:boolean;timezone:string;cards:GuideCard[]}
const categories=['All','Journey','Call Issues','Not Responding','Special','Queues'];
export function filterGuide(cards:GuideCard[],search:string,category:string) {
  const words=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter(card=>(category==='All'||card.category===category)&&words.every(word=>
    `${card.code} ${card.label} ${card.status} ${card.meaning}`.toLowerCase().includes(word)));
}
export function WorkflowGuideCard({card}:{card:GuideCard}) {
  return <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm [overflow-wrap:anywhere] sm:p-5">
    <div className="mb-3 flex flex-wrap items-center gap-2"><span className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700">{card.code}</span><span className="text-xs text-slate-500">{card.category}</span></div>
    <h3 className="text-base font-semibold text-slate-900">{card.label}</h3><p className="mt-1 text-sm text-slate-600">{card.meaning}</p>
    <ol aria-label={`${card.label} timeline`} className="my-4 space-y-3 border-l-2 border-brand-100 pl-4">
      {card.steps.map((step,index)=><li key={step} className="relative text-sm"><span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500"/><span className="font-medium">{step}</span>
        {index===0&&<p className="mt-1 text-xs leading-relaxed text-slate-500">{card.first}</p>}
        {index===1&&<p className="mt-1 text-xs leading-relaxed text-slate-500">{card.second}</p>}
      </li>)}
    </ol>
    {!card.automaticAging&&<p className="rounded-lg bg-slate-50 p-2 text-xs font-medium">No automatic Old/Pending timer</p>}
    {card.special&&<p className={`rounded-lg p-3 text-xs leading-relaxed ${card.status==='respond_hi'?'bg-amber-50 text-amber-900':'bg-sky-50 text-sky-900'}`}>{card.special}</p>}
  </article>;
}
export function GuideReferenceNotes() {
  return <div className="grid min-w-0 gap-3 lg:grid-cols-3">
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold">Custom Follow-Up Overrides Automatic Timers</h2><p className="mt-2 text-sm">“Call me after 4 days.” Schedule that follow-up: automatic Old/Pending aging stays paused, even after the scheduled time passes. Work the lead when due.</p><p className="mt-2 text-sm">Before the scheduled time, another remark keeps the schedule unless you explicitly clear or replace it. Once due, the lead appears in Follow-up; saving a new primary remark completes that schedule and starts the new remark timer.</p></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">Worked = N + O</h2><p className="mt-2 text-sm">Any real counselor remark is work. N counts leads worked while New; O counts leads worked while Old or Pending. A remark outside those queues does not add to N/O.</p><p className="mt-2 text-sm">New → CC: N +1. Later Old → PM: O +1. That lead contributes Worked = 2, with one card showing both badges. Repeated work in the same bucket counts once per reporting period.</p><p className="mt-2 text-xs text-slate-600">Worked uses the day of work; Leads Received uses the assignment date.</p></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">Read the journey tracker</h2><p className="mt-3 break-words text-sm font-semibold text-brand-700">New → CC → OL → Pending</p><p className="mt-2 text-sm">New means the lead was new. CC means Communication Completed. OL means Old Leads. Pending means awaiting required action.</p><p className="mt-2 text-sm">These are past steps. A lead currently Pending is no longer active in CC or Old; its history stays visible.</p></section>
  </div>;
}
function GuideContent() {
  const {user}=useAuth();
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('All');
  const query=useQuery({queryKey:['counselor-guide',user?.id],queryFn:()=>apiGet<GuideResponse>('/counselor-workflow/v1/guide'),
    enabled:Boolean(user&&['member','partner'].includes(user.role)),staleTime:60000});
  if(query.isError) return <div role="alert" className="card p-4">Could not load the CRM Guide. <button className="btn-secondary" onClick={()=>query.refetch()}>Retry</button></div>;
  if(!query.data) return <div role="status" className="card p-5">Loading workflow guide…</div>;
  const cards=filterGuide(query.data.cards,search,category);
  return <div className="min-w-0 max-w-full space-y-5">
    {!query.data.enabled&&<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">This guide describes the new counselor workflow. It is not enabled for your account yet; your current workspace may behave differently.</p>}
    <section className="rounded-2xl border border-brand-100 bg-brand-50 p-4 sm:p-5">
      <div className="flex items-center gap-2 font-semibold text-brand-800"><BookOpen className="h-5 w-5 shrink-0" aria-hidden="true"/>Your lead’s journey</div>
      <p className="mt-3 text-sm leading-relaxed">New → add a remark → primary remark journey → where a timer applies, journey + Old Leads → Pending.</p>
      <p className="mt-2 text-sm">CC + Old means the lead remains in Communication Completed and has also aged into Old. At Pending, active remark-tab and Old membership end; history stays visible.</p>
      <p className="mt-2 text-sm">Select one Primary Status to choose the journey and timer. Secondary statuses are saved as context. A new primary remark replaces the previous timer. An older remark form without a primary may leave the lead waiting for you to select one.</p>
      <p className="mt-3 flex items-center gap-2 text-xs text-brand-800"><Clock3 className="h-4 w-4 shrink-0" aria-hidden="true"/>All times use {query.data.timezone}. Tab updates can take a short time to appear.</p>
    </section>
    <GuideReferenceNotes/>
    <section aria-label="Find a workflow" className="space-y-3">
      <label className="relative block"><span className="sr-only">Search remark or code</span><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true"/><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search remark or code…" className="input min-h-11 w-full min-w-0 pl-9"/></label>
      <div className="flex flex-wrap gap-2" aria-label="Guide categories">{categories.map(value=><button key={value} type="button" aria-pressed={category===value} onClick={()=>setCategory(value)} className={`min-h-11 rounded-full border px-3 text-sm ${category===value?'border-brand-600 bg-brand-600 text-white':'border-slate-200 bg-white text-slate-700'}`}>{value}</button>)}</div>
      <p aria-live="polite" className="text-xs text-slate-500">{cards.length} workflows</p>
      {!cards.length?<div className="rounded-xl border border-dashed p-6 text-center"><p>No matching remarks.</p><button className="btn-secondary mt-3" onClick={()=>{setSearch('');setCategory('All');}}>Clear search and filters</button></div>:
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{cards.map(card=><WorkflowGuideCard key={card.status} card={card}/>)}</div>}
    </section>
  </div>;
}
export default function CrmGuidePage() {
  return <AppShell title="CRM Workflow Guide" subtitle="Understand what each remark does, when a lead moves to Old Leads, and when it becomes Pending." roles={['member','partner']}><GuideContent/></AppShell>;
}
