'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, Mail, UserRound } from 'lucide-react';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('As senhas não correspondem.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, role: 'technician' }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : null;
        setError(data?.error || 'Cadastro falhou.');
        return;
      }

      router.push('/login?registered=true');
    } catch (registerError) {
      console.error('[register] error:', registerError);
      setError('Erro ao cadastrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-semibold text-primary">Cadastro</p>
          <h1 className="mt-2 text-2xl font-semibold">Criar acesso de técnico</h1>
          <p className="mt-2 text-sm text-muted-foreground">O administrador deve vincular este usuário ao cadastro do técnico.</p>
        </div>

        {error ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Nome completo</span>
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="w-full bg-transparent outline-none" required />
            </div>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="w-full bg-transparent outline-none" required />
            </div>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Senha</span>
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <LockKeyhole className="h-4 w-4 text-muted-foreground" />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="w-full bg-transparent outline-none" required />
            </div>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Confirmar senha</span>
            <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <LockKeyhole className="h-4 w-4 text-muted-foreground" />
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" className="w-full bg-transparent outline-none" required />
            </div>
          </label>
          <button type="submit" disabled={loading} className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {loading ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Já tem acesso?{' '}
          <Link href="/login" className="font-medium text-primary">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
