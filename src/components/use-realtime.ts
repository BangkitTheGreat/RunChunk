'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient as createBrowserSupabase } from '@/lib/supabase/browser';

/** Collapses bursts of Realtime events into at most one in-flight refetch plus one follow-up. */
function coalesce(fn: () => Promise<void>) {
  let running = false;
  let again = false;
  const go = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await fn();
      } while (again);
    } finally {
      running = false;
    }
  };
  return go;
}

export type Subscription = { table: 'executions' | 'execution_logs'; filter: string };

/**
 * Supabase Realtime (Postgres Changes, owner-filtered by RLS) as a change signal only: every event and every
 * (re)subscribe triggers a refetch through the API, which stays the source of truth. No polling.
 * Returns the live state: true when subscribed, false after a channel error, null when not subscribed.
 */
export function useRealtimeRefetch(key: string | undefined, subscriptions: Subscription[], refetch: () => Promise<void>) {
  const [live, setLive] = useState<boolean | null>(null);
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  const subsKey = JSON.stringify(subscriptions);

  useEffect(() => {
    if (!key) return;
    const subs = JSON.parse(subsKey) as Subscription[];
    const run = coalesce(() => refetchRef.current());
    const onWake = () => void run();
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    // Initial load never waits for Realtime; an unreachable socket must not leave the view empty.
    void run();
    let supabase: ReturnType<typeof createBrowserSupabase>;
    try {
      supabase = createBrowserSupabase();
    } catch {
      return () => {
        window.removeEventListener('focus', onWake);
        window.removeEventListener('online', onWake);
      };
    }
    let channel = supabase.channel(`runchunk:${key}:${crypto.randomUUID()}`);
    for (const sub of subs) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: sub.table, filter: sub.filter },
        () => void run()
      );
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setLive(true);
        // Covers events missed before the first subscribe and during any disconnect.
        void run();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setLive(false);
      }
    });
    return () => {
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
      void supabase.removeChannel(channel);
      setLive(null);
    };
  }, [key, subsKey]);

  return live;
}
