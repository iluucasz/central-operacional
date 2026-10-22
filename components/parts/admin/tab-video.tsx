'use client';

import { useState } from 'react';
import { ExternalLink, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** One tutorial per tab of Venda de Peças (YouTube, unlisted). Keys are the tab values of the admin page. */
const TAB_VIDEOS: Record<string, { id: string; label: string }> = {
  overview: { id: 'G1rkY_Xfm8c', label: 'Resumo' },
  sales: { id: 'dnyfodFQcqk', label: 'Vendas' },
  catalog: { id: '41QJx5UTj0M', label: 'Peças' },
  movements: { id: '5ydxsbJkg0o', label: 'Movimentações' },
  technicians: { id: 'siiltiAaJv4', label: 'Técnicos' },
  inventory: { id: 'sY23VaOGXl0', label: 'Inventário' },
  account: { id: 'Gn_MfML90ss', label: 'Acerto' },
  finance: { id: 'SynyTaGq_W8', label: 'Financeiro' },
  settings: { id: 'hqUdhjJLHVM', label: 'Ajustes' },
};

/**
 * A slim bar above the tab with a button that opens the tutorial video of that tab. The player is only
 * created when the button is clicked, so nothing is loaded from YouTube until someone asks for it.
 * Render it with `key={tab}` so every tab starts closed.
 */
export function TabVideo({ tab }: { tab: string }) {
  const [open, setOpen] = useState(false);
  const video = TAB_VIDEOS[tab];
  if (!video) return null;

  return (
    <section className="rounded-xl border bg-card" aria-label={`Vídeo sobre a aba ${video.label}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Play className="h-4 w-4 text-primary" aria-hidden="true" />
          Quer ver como funciona a aba {video.label}? Tem um vídeo rápido.
        </p>
        <div className="flex items-center gap-2">
          {open ? (
            <a
              href={`https://youtu.be/${video.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              Abrir no YouTube
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
          <Button type="button" size="sm" variant={open ? 'outline' : 'default'} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? <X className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {open ? 'Fechar vídeo' : 'Ver vídeo'}
          </Button>
        </div>
      </div>
      {open ? (
        <div className="border-t p-3 sm:p-4">
          <div className="mx-auto aspect-video w-full max-w-3xl overflow-hidden rounded-lg bg-black">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1`}
              title={`Vídeo sobre a aba ${video.label}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
