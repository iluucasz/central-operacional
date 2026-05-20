export function LoadingState({ label = 'Carregando dados...' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
        {label}
      </div>
    </div>
  );
}
