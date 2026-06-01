'use client';

import { useEffect, useState } from 'react';
import {
  BookOpen,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  FolderOpen,
  Globe2,
  Search,
  Shield,
  UploadCloud,
  UserRound,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
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

type AudienceBucket = 'Global' | 'Administrativo' | 'Individual';

const initialUploadForm = {
  title: '',
  category: 'Operação',
  audience: 'Global' as AudienceBucket,
};

const categorySuggestions = ['Operação', 'Cobertura', 'RH', 'Financeiro', 'Compliance', 'Treinamento', 'Comunicados'];

const audienceSections: Array<{
  id: AudienceBucket;
  label: string;
  description: string;
  icon: typeof Globe2;
  tone: 'info' | 'warning' | 'success';
  accentClassName: string;
}> = [
  {
    id: 'Global',
    label: 'Globais',
    description: 'Documentos amplos para operação, cobertura e consulta geral da equipe.',
    icon: Globe2,
    tone: 'info',
    accentClassName: 'border-sky-200 bg-sky-50/80',
  },
  {
    id: 'Individual',
    label: 'Individuais',
    description: 'Materiais pessoais, onboarding, kits de responsabilidade e comunicados direcionados.',
    icon: UserRound,
    tone: 'success',
    accentClassName: 'border-emerald-200 bg-emerald-50/80',
  },
  {
    id: 'Administrativo',
    label: 'Administrativos',
    description: 'Rotinas de fechamento, auditoria, backoffice e documentos restritos à gestão.',
    icon: Shield,
    tone: 'warning',
    accentClassName: 'border-amber-200 bg-amber-50/80',
  },
];

function normalizeDocumentAudience(value: string): AudienceBucket {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('admin')) return 'Administrativo';
  if (
    normalized.includes('individual') ||
    normalized.includes('tecnico') ||
    normalized.includes('colaborador') ||
    normalized.includes('pessoal')
  ) {
    return 'Individual';
  }

  return 'Global';
}

function getSectionConfig(bucket: AudienceBucket) {
  return audienceSections.find((section) => section.id === bucket) ?? audienceSections[0];
}

export default function AdminLibraryPage() {
  const { user, loading } = useAppSession();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<LibraryDocument[]>(demoDocuments);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [activeAudience, setActiveAudience] = useState<'all' | AudienceBucket>('all');
  const [uploadForm, setUploadForm] = useState(initialUploadForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
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

  function resetUploadState() {
    setUploadForm(initialUploadForm);
    setSelectedFile(null);
    setUploadError('');
  }

  function handleUploadDialogChange(open: boolean) {
    if (!open && !uploading) {
      resetUploadState();
    }

    setIsUploadDialogOpen(open);
  }

  async function handleUpload() {
    if (!selectedFile) {
      setUploadError('Selecione um PDF antes de enviar.');
      return;
    }

    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', uploadForm.title.trim() || selectedFile.name.replace(/\.pdf$/i, ''));
      formData.append('category', uploadForm.category.trim() || 'Não classificado');
      formData.append('audience', uploadForm.audience);

      const response = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const created = await response.json();
        setDocuments((current) => [created, ...current.filter((document) => document.id !== created.id)]);
        setIsUploadDialogOpen(false);
        resetUploadState();
      } else {
        setUploadError('Não foi possível enviar o documento. Revise os dados e tente novamente.');
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
    const matchesQuery = !query || haystack.includes(normalizeText(query));
    const matchesAudience = activeAudience === 'all' || normalizeDocumentAudience(document.audience) === activeAudience;

    return matchesQuery && matchesAudience;
  });

  filteredDocuments.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const documentsByAudience = {
    Global: filteredDocuments.filter((document) => normalizeDocumentAudience(document.audience) === 'Global'),
    Individual: filteredDocuments.filter((document) => normalizeDocumentAudience(document.audience) === 'Individual'),
    Administrativo: filteredDocuments.filter((document) => normalizeDocumentAudience(document.audience) === 'Administrativo'),
  } satisfies Record<AudienceBucket, LibraryDocument[]>;

  const audienceTotals = {
    Global: documents.filter((document) => normalizeDocumentAudience(document.audience) === 'Global').length,
    Individual: documents.filter((document) => normalizeDocumentAudience(document.audience) === 'Individual').length,
    Administrativo: documents.filter((document) => normalizeDocumentAudience(document.audience) === 'Administrativo').length,
  } satisfies Record<AudienceBucket, number>;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Base de conhecimento"
        title="Biblioteca interna"
        description="Monte uma galeria organizada de documentos globais, individuais e administrativos para operação, RH e gestão."
      >
        <Dialog open={isUploadDialogOpen} onOpenChange={handleUploadDialogChange}>
          <DialogTrigger asChild>
            <Button>
              <UploadCloud className="h-4 w-4" />
              Enviar PDF
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Novo documento da galeria</DialogTitle>
              <DialogDescription>
                Cadastre o arquivo com categoria e público para manter a biblioteca organizada desde o upload.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase text-muted-foreground">Título</span>
                <input
                  value={uploadForm.title}
                  onChange={(event) => setUploadForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Ex.: Checklist de fechamento mensal"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase text-muted-foreground">Categoria</span>
                <input
                  value={uploadForm.category}
                  onChange={(event) => setUploadForm((current) => ({ ...current, category: event.target.value }))}
                  list="library-category-suggestions"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <datalist id="library-category-suggestions">
                  {categorySuggestions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </label>
            </div>

            <label className="space-y-1.5">
              <span className="text-xs font-medium uppercase text-muted-foreground">Público do documento</span>
              <select
                value={uploadForm.audience}
                onChange={(event) => setUploadForm((current) => ({ ...current, audience: event.target.value as AudienceBucket }))}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="Global">Global</option>
                <option value="Individual">Individual</option>
                <option value="Administrativo">Administrativo</option>
              </select>
            </label>

            <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/40 p-8 text-center transition-colors hover:border-primary">
              <UploadCloud className="mb-3 h-9 w-9 text-primary" />
              <span className="font-semibold">{selectedFile ? selectedFile.name : 'Selecionar PDF'}</span>
              <span className="mt-1 text-sm text-muted-foreground">Coberturas, manuais, documentos internos e materiais de apoio</span>
              <input
                type="file"
                accept=".pdf"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;

                  setSelectedFile(file);
                  setUploadError('');
                  setUploadForm((current) => ({
                    ...current,
                    title: current.title.trim() ? current.title : file.name.replace(/\.pdf$/i, ''),
                  }));
                  event.target.value = '';
                }}
              />
            </label>

            {uploadError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{uploadError}</div> : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => handleUploadDialogChange(false)} disabled={uploading}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void handleUpload()} disabled={uploading || !selectedFile}>
                <UploadCloud className="h-4 w-4" />
                {uploading ? 'Enviando documento' : 'Adicionar à galeria'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-4">
        <MetricCard title="Documentos" value={documents.length} hint="Arquivos catalogados" icon={BookOpen} />
        <MetricCard title="Globais" value={audienceTotals.Global} hint="Materiais amplos para toda a operação" icon={Globe2} tone="success" />
        <MetricCard title="Individuais" value={audienceTotals.Individual} hint="Kits e documentos direcionados" icon={UserRound} />
        <MetricCard title="Administrativos" value={audienceTotals.Administrativo} hint="Backoffice, fechamento e auditoria" icon={Shield} tone="warning" />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Galeria de documentos"
          description="Busque, filtre por público e navegue a biblioteca como coleções visuais de PDF."
          action={
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por título, categoria ou público"
                  className="w-64 bg-transparent text-sm outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant={activeAudience === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveAudience('all')}>
                  <Filter className="h-4 w-4" />
                  Tudo
                </Button>
                {audienceSections.map((section) => {
                  const Icon = section.icon;

                  return (
                    <Button
                      key={section.id}
                      type="button"
                      variant={activeAudience === section.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveAudience(section.id)}
                    >
                      <Icon className="h-4 w-4" />
                      {section.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          }
        >
          {filteredDocuments.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Nenhum documento encontrado"
              description="Ajuste a busca ou o filtro de público para localizar outra coleção da galeria."
            />
          ) : (
            <div className="space-y-6">
              {audienceSections
                .filter((section) => activeAudience === 'all' || activeAudience === section.id)
                .filter((section) => documentsByAudience[section.id].length > 0)
                .map((section) => {
                  const sectionDocuments = documentsByAudience[section.id];
                  const Icon = section.icon;

                  return (
                    <section key={section.id} className="space-y-3">
                      <div className={`rounded-xl border p-4 ${section.accentClassName}`}>
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-background text-foreground shadow-sm">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-base font-semibold">{section.label}</h3>
                                <StatusBadge tone={section.tone}>{sectionDocuments.length} documento{sectionDocuments.length === 1 ? '' : 's'}</StatusBadge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {new Set(sectionDocuments.map((document) => document.category)).size} categoria{new Set(sectionDocuments.map((document) => document.category)).size === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {sectionDocuments.map((document) => {
                          const bucket = normalizeDocumentAudience(document.audience);
                          const cardSection = getSectionConfig(bucket);
                          const CardIcon = cardSection.icon;

                          return (
                            <article key={document.id} className="overflow-hidden rounded-xl border border-border bg-background shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                              <div className={`border-b p-4 ${cardSection.accentClassName}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-start gap-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background text-foreground shadow-sm">
                                      <CardIcon className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{document.category}</p>
                                      <h4 className="mt-1 line-clamp-2 text-base font-semibold text-foreground">{document.title}</h4>
                                    </div>
                                  </div>
                                  <StatusBadge tone={cardSection.tone}>{document.type}</StatusBadge>
                                </div>
                              </div>

                              <div className="space-y-4 p-4">
                                <div className="flex flex-wrap gap-2">
                                  <StatusBadge tone={cardSection.tone}>{cardSection.label}</StatusBadge>
                                  <StatusBadge>{document.category}</StatusBadge>
                                </div>

                                <div className="grid gap-2 text-sm text-muted-foreground">
                                  <div className="flex items-center gap-2">
                                    <Clock3 className="h-4 w-4" />
                                    Atualizado em {formatDate(document.updatedAt)}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4" />
                                    {document.uploadedBy ? `Enviado por ${document.uploadedBy}` : 'Catálogo interno sem remetente informado'}
                                  </div>
                                </div>

                                {document.url ? (
                                  <Button asChild className="w-full">
                                    <a href={document.url} target="_blank" rel="noreferrer">
                                      <ExternalLink className="h-4 w-4" />
                                      Abrir PDF
                                    </a>
                                  </Button>
                                ) : (
                                  <Button type="button" variant="secondary" className="w-full" disabled>
                                    Arquivo ainda não enviado
                                  </Button>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
            </div>
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
