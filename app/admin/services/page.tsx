'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Users, Wrench } from 'lucide-react';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { demoServices, demoTechnicians } from '@/lib/demo-data';
import { formatCurrency, formatDate, normalizeText, yearFromCompetence } from '@/lib/formatters';
import type { Service, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const initialFormData = {
  order_code: '',
  technician_id: '',
  service_type: '',
  value: 0,
  date_performed: new Date().toISOString().split('T')[0],
  competence_month: new Date().toISOString().slice(0, 7),
  description: '',
};

type ServiceFormData = typeof initialFormData;

function createInitialFormData(): ServiceFormData {
  return { ...initialFormData };
}

export default function AdminServicesPage() {
  const { user, loading } = useAppSession();
  const [services, setServices] = useState<Service[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [query, setQuery] = useState('');
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [competenceFilter, setCompetenceFilter] = useState('all');
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [formData, setFormData] = useState<ServiceFormData>(createInitialFormData);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      const [servicesRes, techniciansRes] = await Promise.all([fetch('/api/services'), fetch('/api/technicians')]);

      if (servicesRes.ok) {
        const data = await servicesRes.json();
        setServices(data.services ?? []);
      }

      if (techniciansRes.ok) {
        const data = await techniciansRes.json();
        setTechnicians(data.technicians ?? []);
      }
    }

    loadData();
  }, [user]);

  const visibleServices = services.length ? services : demoServices;
  const visibleTechnicians = technicians.length ? technicians : demoTechnicians;
  const inputClassName = 'min-h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition focus:ring-2 focus:ring-ring';

  const sortedTechnicians = useMemo(() => {
    return [...visibleTechnicians].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }, [visibleTechnicians]);

  const servicesWithDetails = useMemo(() => {
    const technicianNameMap = new Map(sortedTechnicians.map((technician) => [technician.id, technician.name]));

    return visibleServices.map((service) => ({
      ...service,
      technician_name: service.technician_name || technicianNameMap.get(service.technician_id) || service.technician_id,
      competence_month: service.competence_month || yearFromCompetence(service.date_performed),
    }));
  }, [sortedTechnicians, visibleServices]);

  const availableTypes = useMemo(() => {
    return Array.from(new Set(servicesWithDetails.map((service) => service.service_type).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, 'pt-BR'),
    );
  }, [servicesWithDetails]);

  const availableCompetences = useMemo(() => {
    return Array.from(new Set(servicesWithDetails.map((service) => service.competence_month || yearFromCompetence(service.date_performed)))).sort(
      (left, right) => right.localeCompare(left, 'pt-BR'),
    );
  }, [servicesWithDetails]);

  const filteredServices = useMemo(() => {
    return servicesWithDetails.filter((service) => {
      const competence = service.competence_month || yearFromCompetence(service.date_performed);
      if (technicianFilter !== 'all' && service.technician_id !== technicianFilter) return false;
      if (typeFilter !== 'all' && service.service_type !== typeFilter) return false;
      if (competenceFilter !== 'all' && competence !== competenceFilter) return false;

      const haystack = normalizeText(
        `${service.order_code} ${service.service_type} ${competence} ${service.technician_name} ${service.description || ''}`,
      );
      return !query || haystack.includes(normalizeText(query));
    });
  }, [competenceFilter, query, servicesWithDetails, technicianFilter, typeFilter]);

  function resetForm() {
    setFormData(createInitialFormData());
    setFormError('');
  }

  function handleFormDialogChange(open: boolean) {
    setIsFormDialogOpen(open);

    if (!open) {
      resetForm();
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setIsSubmitting(true);

    const response = await fetch('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setFormError(data?.error || 'Nao foi possivel salvar a OS.');
      setIsSubmitting(false);
      return;
    }

    const created = (await response.json()) as Service;
    const selectedTechnician = sortedTechnicians.find((technician) => technician.id === formData.technician_id);

    setServices((current) => [
      {
        ...created,
        technician_name: created.technician_name || selectedTechnician?.name || formData.technician_id,
      },
      ...current,
    ]);
    handleFormDialogChange(false);
    setIsSubmitting(false);
  }

  if (loading || !user) {
    return <LoadingState />;
  }

  const totalValue = filteredServices.reduce((total, service) => total + Number(service.value), 0);
  const uniqueCompetences = new Set(filteredServices.map((service) => service.competence_month)).size;
  const collaboratorCount = new Set(filteredServices.map((service) => service.technician_id)).size;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Produção"
        title="Ordens de serviço"
        description="Acompanhe todas as OS dos colaboradores, filtre por colaborador, tipo e competência e faça ajustes pontuais no cadastro."
      >
        <Button type="button" onClick={() => setIsFormDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Cadastrar OS
        </Button>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Ordens" value={filteredServices.length} hint="No filtro atual" icon={Wrench} />
        <MetricCard title="Colaboradores" value={collaboratorCount} hint="Escopo atual da visão" icon={Users} />
        <MetricCard title="Valor bruto" value={formatCurrency(totalValue)} hint="Soma das OS" icon={Wrench} tone="success" />
        <MetricCard title="Competências" value={uniqueCompetences} hint="Períodos distintos" icon={Wrench} tone="warning" />
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-4xl">
          <div className="flex max-h-[88vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Cadastrar OS</DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Use importação para cargas grandes e este formulário para ajustes pontuais.
              </DialogDescription>
            </DialogHeader>

            <form id="service-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
              {formError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr]">
                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Identificação</p>
                    <h3 className="text-base font-semibold text-foreground">Dados principais da OS</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Código da OS</span>
                      <input
                        value={formData.order_code}
                        onChange={(event) => setFormData((current) => ({ ...current, order_code: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Técnico</span>
                      <select
                        value={formData.technician_id}
                        onChange={(event) => setFormData((current) => ({ ...current, technician_id: event.target.value }))}
                        className={inputClassName}
                        required
                      >
                        <option value="">Selecione</option>
                        {sortedTechnicians.map((technician) => (
                          <option key={technician.id} value={technician.id}>
                            {technician.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Tipo</span>
                      <input
                        value={formData.service_type}
                        onChange={(event) => setFormData((current) => ({ ...current, service_type: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Valor</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.value}
                        onChange={(event) => setFormData((current) => ({ ...current, value: Number(event.target.value) }))}
                        className={inputClassName}
                        required
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Execução</p>
                    <h3 className="text-base font-semibold text-foreground">Data, competência e observações</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Data</span>
                      <input
                        type="date"
                        value={formData.date_performed}
                        onChange={(event) => setFormData((current) => ({ ...current, date_performed: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Competência</span>
                      <input
                        type="month"
                        value={formData.competence_month}
                        onChange={(event) => setFormData((current) => ({ ...current, competence_month: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Descrição</span>
                      <textarea
                        value={formData.description}
                        onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                        className="min-h-28 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                      />
                    </label>
                  </div>
                </section>
              </div>
            </form>

            <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => handleFormDialogChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" form="service-form" disabled={isSubmitting} className="min-w-36">
                {isSubmitting ? 'Salvando...' : 'Salvar OS'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-5">
        <DataPanel
          title="Filtros administrativos"
          description="Visão consolidada de todos os colaboradores com recortes por colaborador, tipo, competência e busca textual."
        >
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.85fr))_auto] xl:items-end">
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3.5">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar OS, colaborador, tipo"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Colaborador</span>
              <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} className={inputClassName}>
                <option value="all">Todos</option>
                {sortedTechnicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Tipo</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClassName}>
                <option value="all">Todos</option>
                {availableTypes.map((serviceType) => (
                  <option key={serviceType} value={serviceType}>
                    {serviceType}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Competência</span>
              <select value={competenceFilter} onChange={(event) => setCompetenceFilter(event.target.value)} className={inputClassName}>
                <option value="all">Todas</option>
                {availableCompetences.map((competence) => (
                  <option key={competence} value={competence}>
                    {competence}
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery('');
                setTechnicianFilter('all');
                setTypeFilter('all');
                setCompetenceFilter('all');
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel
          title="Histórico de OS"
          description={`${filteredServices.length} registro(s) encontrados em todos os colaboradores.`}
        >
          {filteredServices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Código</th>
                    <th className="py-3 pr-4 font-medium">Colaborador</th>
                    <th className="py-3 pr-4 font-medium">Tipo</th>
                    <th className="py-3 pr-4 font-medium">Valor</th>
                    <th className="py-3 pr-4 font-medium">Competência</th>
                    <th className="py-3 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.slice(0, 80).map((service) => (
                    <tr key={service.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs">{service.order_code}</td>
                      <td className="py-3 pr-4">{service.technician_name || service.technician_id}</td>
                      <td className="py-3 pr-4">{service.service_type}</td>
                      <td className="py-3 pr-4">{formatCurrency(service.value)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone="info">{service.competence_month || yearFromCompetence(service.date_performed)}</StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(service.date_performed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
              Nenhuma OS encontrada com os filtros atuais.
            </div>
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
