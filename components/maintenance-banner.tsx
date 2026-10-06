'use client';

import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import type { SystemStatus } from '@/lib/system-status';

const POLL_MS = 2 * 60_000;

/** Admin-only notice while the VPS (Porto robot + WhatsApp) doesn't answer — see lib/system-status.ts. */
export function MaintenanceBanner() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/system-status', { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as SystemStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // The app itself being unreachable is not what this notice is about.
      }
    }

    void load();
    const intervalId = window.setInterval(() => void load(), POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  const down = [status?.porto === 'down' ? 'Porto' : null, status?.whatsapp === 'down' ? 'WhatsApp' : null].filter(Boolean);
  if (!down.length) return null;

  const title = down.length === 2 ? 'Módulos Porto e WhatsApp em manutenção' : `Módulo ${down[0]} em manutenção`;
  const effects = [
    status?.porto === 'down' ? 'a importação de horas e escala do Porto' : null,
    status?.whatsapp === 'down' ? 'os envios de WhatsApp' : null,
  ].filter(Boolean);

  return (
    <div className="mb-4 flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <Wrench className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5">
          O servidor da automação (VPS) não está respondendo. Enquanto isso, {effects.join(' e ')} ficam parados. O resto do
          sistema funciona normalmente.
        </p>
      </div>
    </div>
  );
}
