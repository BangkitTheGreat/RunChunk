'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/** Translates server keys (`errors.*`, `status.*`, node summaries) and falls back to the raw key. */
export function useTranslated() {
  const t = useTranslations();
  return useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      t.has(key as unknown as Parameters<typeof t>[0]) ? t(key as unknown as Parameters<typeof t>[0], values) : key,
    [t]
  );
}

/** Locale-aware timestamp, with a dash for missing values. */
export function useStamp() {
  const locale = useLocale();
  return useCallback((value: string | null) => (value ? new Date(value).toLocaleString(locale) : '—'), [locale]);
}
