'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Check, KeyRound, Trash2 } from 'lucide-react';
import { CREDENTIAL_TYPES } from '@/lib/workflow/types';
import type { CredentialType } from '@/lib/workflow/types';
import { useStamp } from './format';
import type { Credential } from './model';
import { request } from './request';

/** Vault page: create or replace a secret (never shown again) and list metadata of stored credentials. */
export function CredentialsView({
  credentials,
  reload,
  fail,
}: {
  credentials: Credential[];
  reload: () => Promise<void>;
  fail: (e: unknown) => void;
}) {
  const t = useTranslations();
  const stamp = useStamp();
  const empty = { name: '', type: 'bearer' as CredentialType, headerName: 'x-api-key', value: '', username: '', password: '' };
  const [form, setForm] = useState(empty);
  const [replacing, setReplacing] = useState<Credential | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    reload().catch(fail);
  }, [reload, fail]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const body = {
        name: form.name,
        type: form.type,
        ...(form.type === 'api_key' ? { headerName: form.headerName, value: form.value } : {}),
        ...(form.type === 'bearer' ? { value: form.value } : {}),
        ...(form.type === 'basic' ? { username: form.username, password: form.password } : {}),
      };
      await request(replacing ? `/api/credentials/${replacing.id}` : '/api/credentials', {
        method: replacing ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      // Drop the secret from memory as soon as the server has it.
      setForm(empty);
      setReplacing(null);
      setNotice(t('credentials.saved'));
      await reload();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (credential: Credential) => {
    if (!confirm(t('credentials.deleteConfirm', { name: credential.name }))) return;
    try {
      await request(`/api/credentials/${credential.id}`, { method: 'DELETE' });
      await reload();
    } catch (error) {
      fail(error);
    }
  };

  return (
    <div className="workflow-home">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('credentials.eyebrow')}</p>
          <h1>{t('credentials.title')}</h1>
          <p>{t('credentials.description')}</p>
        </div>
      </div>

      <div className="credentials-layout">
        <form className="credential-form" onSubmit={submit} autoComplete="off">
          <h2>{replacing ? `${t('credentials.replace')}: ${replacing.name}` : t('credentials.create')}</h2>
          <label className="field-label">
            {t('credentials.name')}
            <input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field-label">
            {t('credentials.type')}
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CredentialType })}>
              {CREDENTIAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`credentials.type_${type}`)}
                </option>
              ))}
            </select>
          </label>
          {form.type === 'api_key' && (
            <label className="field-label">
              {t('credentials.headerName')}
              <input
                required
                className="code-input"
                maxLength={64}
                pattern="[A-Za-z0-9!#$%&'*+.^_`|~\-]+"
                value={form.headerName}
                onChange={(e) => setForm({ ...form, headerName: e.target.value })}
              />
            </label>
          )}
          {form.type === 'basic' ? (
            <>
              <label className="field-label">
                {t('credentials.username')}
                <input required maxLength={256} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </label>
              <label className="field-label">
                {t('credentials.password')}
                <input
                  required
                  type="password"
                  minLength={4}
                  maxLength={1024}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label className="field-label">
              {t('credentials.value')}
              <input
                required
                type="password"
                minLength={8}
                maxLength={4096}
                autoComplete="new-password"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </label>
          )}
          <p className="field-help">{t('credentials.valueHint')}</p>
          <div className="toolbar-buttons">
            <button className="primary-button" disabled={busy}>
              <KeyRound size={15} />
              {replacing ? t('credentials.replace') : t('credentials.create')}
            </button>
            {replacing && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setReplacing(null);
                  setForm(empty);
                }}
              >
                {t('credentials.cancelReplace')}
              </button>
            )}
          </div>
          {notice && (
            <p className="field-help" role="status">
              <Check size={14} /> {notice}
            </p>
          )}
        </form>

        <div className="workflow-list credential-list">
          {credentials.length === 0 ? (
            <p className="dock-empty">{t('credentials.empty')}</p>
          ) : (
            credentials.map((credential) => (
              <div className="workflow-row" key={credential.id}>
                <KeyRound size={18} />
                <span className="workflow-name">
                  {credential.name}
                  <small>
                    {t(`credentials.type_${credential.type}`)}
                    {credential.header_name ? ` · ${credential.header_name}` : ''} · {t('credentials.secretHidden')} ·{' '}
                    {t('credentials.keyVersion', { version: credential.key_version })}
                  </small>
                </span>
                <time className="workflow-date">{stamp(credential.created_at)}</time>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setReplacing(credential);
                    setForm({ ...empty, name: credential.name, type: credential.type, headerName: credential.header_name ?? 'x-api-key' });
                  }}
                >
                  {t('credentials.replace')}
                </button>
                <button
                  className="icon-button"
                  aria-label={`${t('common.delete')} ${credential.name}`}
                  onClick={() => void destroy(credential)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
