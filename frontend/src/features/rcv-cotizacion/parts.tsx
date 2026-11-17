import type { ReactNode } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';

/** Piezas visuales del flujo "Emitir RCV desde cotización" (mismo lenguaje que PlansStep). */

export function SectionTitle({ icon, children, locked }: { icon?: ReactNode; children: ReactNode; locked?: boolean }) {
  return (
    <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-3 inline-flex items-center gap-1.5">
      {icon}
      {children}
      {locked && (
        <span className="ml-1 inline-flex items-center gap-1 normal-case tracking-normal text-[0.65rem] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
          <Lock size={10} /> De la cotización
        </span>
      )}
    </p>
  );
}

export function InfoCard({ title, icon, children, locked }: { title: string; icon?: ReactNode; children: ReactNode; locked?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 sm:p-5 shadow-sm min-w-0">
      <SectionTitle icon={icon} locked={locked}>{title}</SectionTitle>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-semibold text-slate-900 text-right break-words min-w-0">{value || '—'}</span>
    </div>
  );
}

export function AlertBox({ title, children, tone = 'rose' }: { title: string; children: ReactNode; tone?: 'rose' | 'amber' }) {
  const cls = tone === 'rose'
    ? 'border-rose-200 bg-rose-50 text-rose-900'
    : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${cls}`} role="alert">
      <p className="font-black text-sm inline-flex items-center gap-2 mb-1.5">
        <AlertTriangle size={15} /> {title}
      </p>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function fmtFecha(ymd?: string | null): string {
  const m = String(ymd ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
