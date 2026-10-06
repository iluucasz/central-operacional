/**
 * One Porto browser session at a time. Every job and admin action logs into the same Porto account,
 * and two overlapping sessions (e.g. an admin's "Rodar agora" still running when the 23:00 cron
 * fires) can invalidate each other mid-run. Scheduled runs wait for the lock; admin requests are
 * refused instead, so the UI can say a run is already in progress.
 */
let current: { name: string; done: Promise<void>; startedAt: number } | null = null;

export class PortoBusyError extends Error {
  constructor(public readonly runningJob: string) {
    super(`Já existe uma execução do Porto em andamento (${runningJob}). Tente de novo quando ela terminar.`);
    this.name = 'PortoBusyError';
  }
}

export function portoLockHolder(): string | null {
  return current?.name ?? null;
}

/** What holds the lock and for how long — for the stuck-run watchdog. */
export function portoLockInfo(): { name: string; heldForMs: number } | null {
  return current ? { name: current.name, heldForMs: Date.now() - current.startedAt } : null;
}

/** Runs `fn` holding the lock; throws PortoBusyError right away if another job holds it. */
export async function runWithPortoLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (current) throw new PortoBusyError(current.name);
  let release!: () => void;
  current = { name, done: new Promise<void>((resolve) => (release = resolve)), startedAt: Date.now() };
  try {
    return await fn();
  } finally {
    current = null;
    release();
  }
}

/** Waits for any running job to finish, then runs `fn` holding the lock. */
export async function waitForPortoLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  while (current) await current.done;
  return runWithPortoLock(name, fn);
}
