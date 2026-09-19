import type { NotificationSettings } from '@/lib/whatsapp/notification-types';

/** The Evolution connection as read from the server's EVOLUTION_* env vars — display only. */
export interface EnvConnection {
  apiUrl: string;
  instance: string;
  hasApiKey: boolean;
}

export interface WhatsAppConfigForm {
  enabled: boolean;
  testPhone: string;
  appUrl: string;
  notifications: NotificationSettings;
}

export interface TechnicianOption {
  id: string;
  name: string;
  phone: string;
  status: 'active' | 'inactive';
}

export const inputClassName =
  'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60';
