interface DataPanelProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

export function DataPanel({ title, description, children, action, className, contentClassName, titleClassName, descriptionClassName }: DataPanelProps) {
  return (
    <section className={`rounded-md border border-border bg-card shadow-sm ${className ?? ''}`}>
      <div className="flex flex-col gap-2 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className={`text-base font-semibold text-foreground ${titleClassName ?? ''}`}>{title}</h2>
          {description ? <p className={`mt-1 text-sm text-muted-foreground ${descriptionClassName ?? ''}`}>{description}</p> : null}
        </div>
        {action}
      </div>
      <div className={`p-3 ${contentClassName ?? ''}`}>{children}</div>
    </section>
  );
}
