import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  accentText?: boolean;
}

const toneClasses = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
};

const toneTextClasses = {
  default: 'text-foreground',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
};

const toneHintClasses = {
  default: 'text-muted-foreground',
  success: 'text-emerald-700/90',
  warning: 'text-amber-700/90',
  danger: 'text-rose-700/90',
};

export function MetricCard({ title, value, hint, icon: Icon, tone = 'default', accentText = false }: MetricCardProps) {
  return (
    <section className="rounded-md border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
          <p className={`mt-1 truncate text-xl font-semibold ${accentText ? toneTextClasses[tone] : 'text-foreground'}`}>{value}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${toneClasses[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {hint ? <p className={`mt-1 text-xs ${accentText ? toneHintClasses[tone] : 'text-muted-foreground'}`}>{hint}</p> : null}
    </section>
  );
}
