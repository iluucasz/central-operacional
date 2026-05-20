interface ProgressGaugeProps {
  title: string;
  value: number;
  max?: number;
  subtitle?: string;
  active?: boolean;
  onClick?: () => void;
}

export function ProgressGauge({ title, value, max = 160, subtitle, active, onClick }: ProgressGaugeProps) {
  const percent = Math.min(Math.max(value / max, 0), 1);
  const degrees = -90 + percent * 180;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border bg-card p-4 text-left shadow-sm transition-colors ${
        active ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'
      }`}
    >
      <p className="text-xs font-semibold uppercase text-primary">{title}</p>
      <div className="mt-3 flex justify-center">
        <svg viewBox="0 0 180 104" className="h-28 w-full max-w-56">
          <path d="M 24 86 A 66 66 0 0 1 156 86" fill="none" stroke="hsl(0 84% 60%)" strokeWidth="14" />
          <path d="M 42 43 A 66 66 0 0 1 138 43" fill="none" stroke="hsl(43 96% 56%)" strokeWidth="14" />
          <path d="M 90 20 A 66 66 0 0 1 156 86" fill="none" stroke="hsl(158 64% 40%)" strokeWidth="14" />
          <line
            x1="90"
            y1="86"
            x2="90"
            y2="34"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            style={{
              transform: `rotate(${degrees + 90}deg)`,
              transformBox: 'fill-box',
              transformOrigin: '50% 83%',
            }}
          />
          <circle cx="90" cy="86" r="7" fill="currentColor" />
        </svg>
      </div>
      <div className="mt-[-18px] text-center">
        <p className="text-3xl font-semibold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{subtitle ?? 'ordens'}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span
          className={`rounded-md border px-2 py-1 text-xs font-medium ${
            value >= 80 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border text-muted-foreground'
          }`}
        >
          Meta 80
        </span>
        <span
          className={`rounded-md border px-2 py-1 text-xs font-medium ${
            value >= 160 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border text-muted-foreground'
          }`}
        >
          Meta 160
        </span>
      </div>
    </button>
  );
}
