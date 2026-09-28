'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { nextRuns } from '@/lib/workflow/schedule';
import { request } from './request';

interface WebhookEndpoint {
  id: string;
  workflow_id: string;
  token_hint: string;
  created_at: string;
  rotated_at: string | null;
  last_received_at: string | null;
  signing_hint: string | null;
  signing_created_at: string | null;
}

/**
 * Drawer section for trigger.webhook. The raw token exists in the browser only right after create/rotate;
 * afterwards the server returns metadata and a hint, never the token or its hash.
 */
export function WebhookConfig({
  workflowId,
  isActive,
  webhookPerMinute,
  stamp,
  fail,
}: {
  workflowId: string;
  isActive: boolean;
  webhookPerMinute: number | null;
  stamp: (value: string | null) => string;
  fail: (e: unknown) => void;
}) {
  const t = useTranslations();
  const [endpoint, setEndpoint] = useState<WebhookEndpoint | null>(null);
  const [urlPrefix, setUrlPrefix] = useState('');
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request<{ endpoint: WebhookEndpoint | null; urlPrefix: string }>(`/api/workflows/${workflowId}/webhook`)
      .then((data) => {
        if (cancelled) return;
        setEndpoint(data.endpoint);
        setUrlPrefix(data.urlPrefix);
      })
      .catch(fail)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId, fail]);

  const create = async (rotate: boolean) => {
    if (rotate && !confirm(t('editor.webhookConfirmRotate'))) return;
    setBusy(true);
    try {
      const data = await request<{ endpoint: WebhookEndpoint; token: string; url: string }>(`/api/workflows/${workflowId}/webhook`, { method: 'POST' });
      setEndpoint(data.endpoint);
      setFreshUrl(data.url);
      setCopied(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(t('editor.webhookConfirmRemove'))) return;
    setBusy(true);
    try {
      await request(`/api/workflows/${workflowId}/webhook`, { method: 'DELETE' });
      setEndpoint(null);
      setFreshUrl(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string | null, mark: (value: boolean) => void) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      mark(true);
    } catch {
      mark(false);
    }
  };

  const setSigning = async (rotate: boolean) => {
    if (rotate && !confirm(t('editor.webhookSignatureConfirmRotate'))) return;
    setBusy(true);
    try {
      const data = await request<{ endpoint: WebhookEndpoint; secret: string }>(`/api/workflows/${workflowId}/webhook/signature`, { method: 'POST' });
      setEndpoint(data.endpoint);
      setFreshSecret(data.secret);
      setCopiedSecret(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const disableSigning = async () => {
    if (!confirm(t('editor.webhookSignatureConfirmDisable'))) return;
    setBusy(true);
    try {
      const data = await request<{ endpoint: WebhookEndpoint }>(`/api/workflows/${workflowId}/webhook/signature`, { method: 'DELETE' });
      setEndpoint(data.endpoint);
      setFreshSecret(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <p className="field-help">{t('common.loading')}</p>;

  return (
    <>
      <p className={`field-help ${isActive ? '' : 'field-warning'}`}>{t('editor.webhookNeedsActive')}</p>
      {!endpoint ? (
        <>
          <p className="field-help">{t('editor.webhookNoUrl')}</p>
          <button className="primary-button" disabled={busy} onClick={() => void create(false)}>
            <KeyRound size={15} />
            {t('editor.webhookCreate')}
          </button>
        </>
      ) : (
        <>
          <span className="field-label">{t('editor.webhookUrl')}</span>
          {freshUrl ? (
            <>
              <pre className="result-output url-box">POST {freshUrl}</pre>
              <div className="toolbar-buttons">
                <button className="secondary-button" onClick={() => void copy(freshUrl, setCopied)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? t('editor.webhookCopied') : t('editor.webhookCopy')}
                </button>
              </div>
              <p className="field-warning" role="status">{t('editor.webhookTokenOnce')}</p>
              <span className="field-label">{t('editor.webhookCurl')}</span>
              <pre className="result-output url-box">{`curl -X POST '${freshUrl}' \\\n  -H 'content-type: application/json' \\\n  -d '{"email":"demo@example.com","name":"Demo"}'`}</pre>
            </>
          ) : (
            <pre className="result-output url-box">POST {urlPrefix}{t('editor.webhookMasked', { hint: endpoint.token_hint })}</pre>
          )}
          <p className="field-help">
            {t('editor.webhookCreated')}: {stamp(endpoint.created_at)}
            {endpoint.rotated_at ? ` · ${t('editor.webhookRotated')}: ${stamp(endpoint.rotated_at)}` : ''}
            {` · ${t('editor.webhookLastReceived')}: ${stamp(endpoint.last_received_at)}`}
          </p>
          {webhookPerMinute !== null && <p className="field-help">{t('editor.webhookLimit', { limit: webhookPerMinute })}</p>}
          <div className="toolbar-buttons">
            <button className="secondary-button" disabled={busy} onClick={() => void create(true)}>
              <RefreshCw size={14} />
              {t('editor.webhookRotate')}
            </button>
            <button className="danger-button" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={14} />
              {t('editor.webhookRemove')}
            </button>
          </div>

          <span className="field-label signing-title">{t('editor.webhookSignature')}</span>
          <p className="field-help">{t('editor.webhookSignatureHint')}</p>
          {!endpoint.signing_hint ? (
            <>
              <p className="field-help">{t('editor.webhookSignatureNone')}</p>
              <button className="secondary-button" disabled={busy} onClick={() => void setSigning(false)}>
                <ShieldCheck size={14} />
                {t('editor.webhookSignatureEnable')}
              </button>
            </>
          ) : (
            <>
              {freshSecret && (
                <>
                  <span className="field-label">{t('editor.webhookSignatureSecret')}</span>
                  <pre className="result-output url-box">{freshSecret}</pre>
                  <div className="toolbar-buttons">
                    <button className="secondary-button" onClick={() => void copy(freshSecret, setCopiedSecret)}>
                      {copiedSecret ? <Check size={14} /> : <Copy size={14} />}
                      {copiedSecret ? t('editor.webhookCopied') : t('editor.webhookCopy')}
                    </button>
                  </div>
                  <p className="field-warning" role="status">{t('editor.webhookSignatureOnce')}</p>
                  <span className="field-label">{t('editor.webhookSignatureExample')}</span>
                  <pre className="result-output url-box">{`TS=$(date +%s); BODY='{"email":"demo@example.com"}'\nSIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac '${freshSecret}' | sed 's/^.* //')\ncurl -X POST '${freshUrl ?? `${urlPrefix}…${endpoint.token_hint}`}' \\\n  -H 'content-type: application/json' \\\n  -H "x-runchunk-signature: t=$TS,v1=$SIG" \\\n  -d "$BODY"`}</pre>
                </>
              )}
              <p className="field-help">{t('editor.webhookSignatureSet', { date: stamp(endpoint.signing_created_at), hint: endpoint.signing_hint })}</p>
              <div className="toolbar-buttons">
                <button className="secondary-button" disabled={busy} onClick={() => void setSigning(true)}>
                  <RefreshCw size={14} />
                  {t('editor.webhookSignatureRotate')}
                </button>
                <button className="danger-button" disabled={busy} onClick={() => void disableSigning()}>
                  <ShieldOff size={14} />
                  {t('editor.webhookSignatureDisable')}
                </button>
              </div>
            </>
          )}
        </>
      )}
      <p className="field-help">{t('editor.webhookHint')}</p>
    </>
  );
}

const PRESETS: Record<string, string> = {
  every5m: '*/5 * * * *',
  hourly: '0 * * * *',
  daily9: '0 9 * * *',
  weekdays9: '0 9 * * 1-5',
};

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];
  }
}

/** Drawer section for trigger.schedule: preset or custom cron, IANA timezone, and a preview of the next runs. */
export function ScheduleConfig({
  cron,
  timezone,
  onChange,
}: {
  cron: string;
  timezone: string;
  onChange: (data: { cron?: string; timezone?: string }) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const zones = useMemo(() => timezones(), []);
  const preset = Object.entries(PRESETS).find(([, value]) => value === cron)?.[0] ?? 'custom';
  const upcoming = useMemo(() => (cron ? nextRuns(cron, timezone || 'UTC', new Date(), 3) : []), [cron, timezone]);
  const format = (date: Date) => {
    try {
      return date.toLocaleString(locale, { timeZone: timezone || 'UTC', dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return date.toISOString();
    }
  };

  return (
    <>
      <label className="field-label">
        {t('editor.schedulePreset')}
        <select value={preset} onChange={(e) => onChange({ cron: e.target.value === 'custom' ? cron : PRESETS[e.target.value] })}>
          {[...Object.keys(PRESETS), 'custom'].map((key) => (
            <option key={key} value={key}>
              {t(`editor.schedulePresets.${key}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        {t('editor.scheduleCron')}
        <input className="code-input" value={cron} placeholder="0 9 * * 1-5" onChange={(e) => onChange({ cron: e.target.value })} />
      </label>
      <label className="field-label">
        {t('editor.scheduleTimezone')}
        <input className="code-input" list="runchunk-timezones" value={timezone} placeholder="Asia/Jakarta" onChange={(e) => onChange({ timezone: e.target.value })} />
        <datalist id="runchunk-timezones">
          {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </label>
      <span className="field-label">{t('editor.scheduleNext')}</span>
      {upcoming.length ? (
        <ul className="next-runs">
          {upcoming.map((date) => (
            <li key={date.toISOString()}>{format(date)}</li>
          ))}
        </ul>
      ) : (
        <p className="field-warning" role="alert">{t('editor.scheduleInvalid')}</p>
      )}
      <p className="field-help">{t('editor.scheduleHint')}</p>
      <p className="field-help">{t('editor.scheduleData')}</p>
    </>
  );
}
