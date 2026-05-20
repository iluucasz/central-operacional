'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Clock3,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  WalletCards,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

type Role = 'admin' | 'technician';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface AppShellProps {
  children: React.ReactNode;
  role: Role;
  userName?: string;
}

const adminLinks: NavItem[] = [
  { href: '/admin', label: 'Operação', icon: LayoutDashboard },
  { href: '/admin/import', label: 'Importação', icon: FileSpreadsheet },
  { href: '/admin/technicians', label: 'Técnicos', icon: Users },
  { href: '/admin/services', label: 'Serviços', icon: Wrench },
  { href: '/admin/schedule', label: 'Escala', icon: CalendarDays },
  { href: '/admin/payroll', label: 'Folha', icon: WalletCards },
  { href: '/admin/library', label: 'Biblioteca', icon: BookOpen },
];

const technicianLinks: NavItem[] = [
  { href: '/dashboard', label: 'Minha visão', icon: LayoutDashboard },
  { href: '/dashboard/hours', label: 'Banco de horas', icon: Clock3 },
  { href: '/dashboard/schedule', label: 'Agenda', icon: CalendarDays },
  { href: '/dashboard/payroll', label: 'Pagamento', icon: WalletCards },
  { href: '/dashboard/library', label: 'Biblioteca', icon: BookOpen },
];

function getInitials(value?: string) {
  return (value ?? 'Usuário')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

interface ProfileSummaryProps {
  role: Role;
  userName?: string;
}

function ProfileSummary({ role, userName }: ProfileSummaryProps) {
  const initials = getInitials(userName);
  const accessLabel = role === 'admin' ? 'Acesso administrativo' : 'Área do colaborador';

  return (
    <div className="flex min-w-0 items-center gap-3 text-left">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
        {initials || 'U'}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-medium">{userName ?? 'Sem usuário'}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{accessLabel}</span>
      </span>
    </div>
  );
}

interface LogoutButtonProps {
  isLoggingOut: boolean;
  onLogout: () => void;
}

function LogoutButton({ isLoggingOut, onLogout }: LogoutButtonProps) {
  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={isLoggingOut}
      className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" />
      {isLoggingOut ? 'Saindo...' : 'Sair'}
    </button>
  );
}

export function AppShell({ children, role, userName }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const links = role === 'admin' ? adminLinks : technicianLinks;
  const rootHref = role === 'admin' ? '/admin' : '/dashboard';
  const activeLink = links.find((link) =>
    link.href === rootHref ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`),
  );

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-border bg-card px-3 lg:hidden">
        <div className="min-w-0 flex-1 pr-2">
          <ProfileSummary role={role} userName={userName} />
        </div>
        <div className="flex items-center gap-2">
          <LogoutButton isLoggingOut={isLoggingOut} onLogout={handleLogout} />
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background"
            aria-label="Abrir navegação"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <aside
        className={`${
          open ? 'block' : 'hidden'
        } fixed inset-x-0 top-12 z-30 border-b border-border bg-card lg:sticky lg:top-0 lg:block lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 flex-col justify-center border-b border-border px-5">
            <p className="text-base font-semibold leading-tight">Central Operacional</p>
            <p className="mt-1 text-xs text-muted-foreground">{role === 'admin' ? 'Operação e gestão integrada' : 'Área do colaborador'}</p>
          </div>

          <nav className="flex-1 space-y-1.5 px-3 py-4">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = activeLink?.href === link.href;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-10 items-center gap-2.5 rounded-md px-3.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
            {role === 'admin' ? 'Administração' : 'Colaborador'}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur lg:flex">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{activeLink?.label ?? 'Painel'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{role === 'admin' ? 'Painel administrativo' : 'Painel do técnico'}</p>
          </div>
          <div className="flex items-center gap-3">
            <ProfileSummary role={role} userName={userName} />
            <LogoutButton isLoggingOut={isLoggingOut} onLogout={handleLogout} />
          </div>
        </header>
        <div className="w-full px-3 py-4 sm:px-4 lg:px-4">{children}</div>
      </main>
    </div>
  );
}
