'use client';

import { useEffect, useState } from 'react';
import { BookOpen, FileText, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { demoDocuments } from '@/lib/demo-data';
import { formatDate, normalizeText } from '@/lib/formatters';
import type { LibraryDocument } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

export default function TechnicianLibraryPage() {
  const { user, loading } = useAppSession();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<LibraryDocument[]>(demoDocuments);

  useEffect(() => {
    async function loadDocuments() {
      if (!user) return;
      const response = await fetch('/api/documents');
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents ?? demoDocuments);
      }
    }

    loadDocuments();
  }, [user]);

  if (loading || !user) {
    return <LoadingState />;
  }

  const filteredDocuments = documents.filter((document) => {
    const haystack = normalizeText(`${document.title} ${document.category}`);
    return !query || haystack.includes(normalizeText(query));
  });

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Consulta rápida"
        title="Biblioteca"
        description="Materiais internos, coberturas e procedimentos disponíveis para toda a equipe."
      />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Documentos" value={documents.length} hint="Disponíveis para toda a equipe" icon={BookOpen} />
        <MetricCard title="Categorias" value={new Set(documents.map((document) => document.category)).size} hint="Materiais catalogados" icon={FileText} />
        <MetricCard title="Formato" value="PDF" hint="Consulta dos arquivos cadastrados" icon={Search} />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Materiais"
          description="Busque por cobertura, procedimento ou categoria."
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar"
                className="w-48 bg-transparent text-sm outline-none"
              />
            </div>
          }
        >
          <div className="grid gap-3">
            {filteredDocuments.map((document) => (
              <div key={document.id} className="rounded-md border border-border bg-background p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{document.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Atualizado em {formatDate(document.updatedAt)}</p>
                  </div>
                  <StatusBadge tone="info">{document.type}</StatusBadge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge>{document.category}</StatusBadge>
                  {document.url ? (
                    <a href={document.url} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center rounded-md border border-border px-2 text-xs font-medium hover:bg-secondary">
                      Abrir
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
