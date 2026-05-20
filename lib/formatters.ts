export function formatCurrency(value: number | string | null | undefined): string {
  const numericValue = Number(value ?? 0);

  return numericValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function formatNumber(value: number | string | null | undefined): string {
  return Number(value ?? 0).toLocaleString('pt-BR');
}

export function formatPercent(value: number | string | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  })}%`;
}

export function formatHours(value: number | string | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}h`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('pt-BR');
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('pt-BR');
}

export function parseMoney(value: unknown): number {
  if (typeof value === 'number') return value;

  const normalized = String(value ?? '0')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .toLowerCase();
}

export function yearFromCompetence(competence: string | null | undefined): string {
  const match = String(competence ?? '').match(/20\d{2}/);
  return match?.[0] ?? 'Sem ano';
}

export function monthKeyFromDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 7);
}

export function compactName(value: string | null | undefined): string {
  const parts = String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[parts.length - 1]}`;
}
