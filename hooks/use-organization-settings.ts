'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_ORGANIZATION_SETTINGS, normalizeOrganizationSettings, type OrganizationSettings } from '@/lib/organization-settings';

// Module scope: one request per page load, shared by every component that asks. A technician only
// receives their subset from the API; normalize fills the rest with defaults they never act on.
let cachedSettings: OrganizationSettings | null = null;
let pendingSettings: Promise<OrganizationSettings> | null = null;

function fetchSettings() {
  if (!pendingSettings) {
    pendingSettings = fetch('/api/organization-settings', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`organization_settings_${response.status}`);
        const data = await response.json();
        cachedSettings = normalizeOrganizationSettings(data?.settings);
        return cachedSettings;
      })
      .catch((error) => {
        console.error('[organization-settings] load error:', error);
        // Not cached, so the next screen retries; meanwhile the defaults keep the screens usable.
        pendingSettings = null;
        return { ...DEFAULT_ORGANIZATION_SETTINGS };
      });
  }

  return pendingSettings;
}

/** Called by the settings screen after saving, and on logout. */
export function resetOrganizationSettingsCache() {
  cachedSettings = null;
  pendingSettings = null;
}

export function useOrganizationSettings({ enabled = true }: { enabled?: boolean } = {}) {
  const [settings, setSettings] = useState<OrganizationSettings | null>(cachedSettings);

  useEffect(() => {
    if (!enabled || settings) return;

    let mounted = true;
    fetchSettings().then((value) => {
      if (mounted) setSettings(value);
    });

    return () => {
      mounted = false;
    };
  }, [enabled, settings]);

  return {
    settings: settings ?? DEFAULT_ORGANIZATION_SETTINGS,
    loading: enabled && !settings,
  };
}
