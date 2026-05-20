'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, Mail } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : null;
        setError(data?.error || 'Não foi possível entrar.');
        return;
      }

      const data = await response.json();
      router.push(data.user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (loginError) {
      console.error('[login] error:', loginError);
      setError('Erro ao conectar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary/20 p-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold text-primary">Central Operacional</p>
          <h1 className="mt-3 text-2xl font-semibold">Entrar no sistema</h1>
          <p className="mt-2 text-sm text-muted-foreground">Use seu email e senha para acessar a central.</p>
        </div>

        {error ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        <form onSubmit={handleSubmit} className="space-y-4">
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
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="w-full bg-transparent outline-none" required />
            </div>
          </label>
          <button type="submit" disabled={loading} className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Não tem conta?{' '}
          <Link href="/register" className="font-medium text-primary">
            Cadastre-se
          </Link>
        </p>
      </section>
    </main>
  );
}
