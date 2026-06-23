'use client';

import { MessageCircle, MessageSquarePlus, MoreHorizontal, Phone, UserCog } from 'lucide-react';

interface Props { onCall: () => void; onChat: () => void; onRemark: () => void; onReassign?: () => void; callDisabled?: boolean }

export function LeadActionBar({ onCall, onChat, onRemark, onReassign, callDisabled }: Props) {
  return <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,.08)] lg:hidden"><Action icon={<Phone />} label="Call" onClick={onCall} disabled={callDisabled} /><Action icon={<MessageCircle />} label="Chat" onClick={onChat} /><Action icon={<MessageSquarePlus />} label="Remark" onClick={onRemark} />{onReassign && <button onClick={onReassign} aria-label="Reassign lead" className="absolute right-2 top-[-42px] rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow"><MoreHorizontal className="h-4 w-4" /><span className="sr-only"><UserCog />Reassign</span></button>}</div>;
}

function Action({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}</button>;
}
