'use client';

import { useEffect, useState } from 'react';
import { BookOpen, FileText, Search, UploadCloud } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { demoDocuments } from '@/lib/demo-data';
import { formatDate, normalizeText } from '@/lib/formatters';
import type { LibraryDocument } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

export default function AdminLibraryPage() {
  const { user, loading } = useAppSession();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<LibraryDocument[]>(demoDocuments);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const created = await response.json();
        setDocuments((current) => [created, ...current.filter((document) => document.id !== created.id)]);
        setIsUploadDialogOpen(false);
      }
    } finally {
      setUploading(false);
    }
  }

  if (loading || !user) {
    return <LoadingState />;
  }

  const filteredDocuments = documents.filter((document) => {
    const haystack = normalizeText(`${document.title} ${document.category} ${document.audience}`);
    return !query || haystack.includes(normalizeText(query));
  });

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Base de conhecimento"
        title="Biblioteca interna"
        description="Organize PDFs de cobertura, procedimentos, regras internas e materiais de apoio para toda a equipe."
      >
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UploadCloud className="h-4 w-4" />
              Enviar PDF
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enviar PDF</DialogTitle>
              <DialogDescription>
                Somente administradores podem adicionar documentos à biblioteca.
              </DialogDescription>
            </DialogHeader>

            <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border bg-secondary/40 p-8 text-center transition-colors hover:border-primary">
              <UploadCloud className="mb-3 h-9 w-9 text-primary" />
              <span className="font-semibold">{uploading ? 'Enviando PDF' : 'Selecionar PDF'}</span>
              <span className="mt-1 text-sm text-muted-foreground">Coberturas, manuais, documentos internos</span>
              <input
                type="file"
                accept=".pdf"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;

                  void handleUpload(file);
                  event.target.value = '';
                }}
              />
            </label>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Documentos" value={documents.length} hint="Arquivos catalogados" icon={BookOpen} />
        <MetricCard title="Categorias" value={new Set(documents.map((document) => document.category)).size} hint="Cobertura, RH, operação" icon={FileText} />
        <MetricCard title="Upload" value="Admin" hint="Somente administradores enviam PDF" icon={UploadCloud} tone="warning" />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Documentos cadastrados"
          description="Busca por título, categoria ou público."
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
                  <div className="min-w-0">
                    <p className="font-semibold">{document.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{document.category} - atualizado em {formatDate(document.updatedAt)}</p>
                  </div>
                  <StatusBadge tone="info">{document.type}</StatusBadge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge>{document.audience}</StatusBadge>
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
