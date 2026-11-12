import React, { useEffect, useState } from 'react';
import { Bell, History, Send, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { User } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface SettingsViewProps {
  currentUser: User;
}

interface NotificationConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  webhookUrl: string;
  webhookType: 'slack' | 'telegram' | 'generic';
  notifyOnCriticalCapa: boolean;
  notifyOnApproval: boolean;
}

interface AuditLogEntry {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser }) => {
  const { lang } = useLanguage();
  const isId = lang === 'id';
  const isAdmin = currentUser.role === 'Site Manager';

  const [config, setConfig] = useState<NotificationConfig>({
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    webhookUrl: '',
    webhookType: 'generic',
    notifyOnCriticalCapa: true,
    notifyOnApproval: true,
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      fetch('/api/notifications/settings', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.settings) {
            setConfig({
              smtpHost: d.settings.smtpHost || '',
              smtpPort: d.settings.smtpPort || 587,
              smtpUser: d.settings.smtpUser || '',
              smtpPass: d.settings.smtpPass || '',
              smtpFrom: d.settings.smtpFrom || '',
              webhookUrl: d.settings.webhookUrl || '',
              webhookType: d.settings.webhookType || 'generic',
              notifyOnCriticalCapa: Boolean(d.settings.notifyOnCriticalCapa),
              notifyOnApproval: Boolean(d.settings.notifyOnApproval),
            });
          }
        })
        .catch(() => {});
    }

    fetch('/api/audit-logs', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.auditLogs) {
          setAuditLogs(d.auditLogs);
        }
      })
      .catch(() => {});
  }, [isAdmin]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    setErrorMsg(null);
    setSaving(true);
    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings.');
      setStatusMsg(isId ? 'Pengaturan notifikasi disimpan.' : 'Notification settings saved.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestNotification = async () => {
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.errors?.length) {
        setErrorMsg(data.errors.join(' | '));
      } else if (!data.webhookSent && !data.emailSent) {
        setErrorMsg(
          isId
            ? 'Belum ada Webhook URL atau SMTP Host yang dikonfigurasi.'
            : 'No Webhook URL or SMTP Host configured yet.'
        );
      } else {
        setStatusMsg(
          isId
            ? `Test terkirim (Webhook: ${data.webhookSent ? 'OK' : '-'}, Email: ${data.emailSent ? 'OK' : '-'})`
            : `Test dispatched (Webhook: ${data.webhookSent ? 'OK' : '-'}, Email: ${data.emailSent ? 'OK' : '-'})`
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Test notification failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
          {isId ? 'Notifikasi & Audit Trail' : 'Notifications & Audit Trail'}
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {isId
            ? 'Konfigurasi alert SMTP/Webhook untuk temuan kritis & approval, serta log aktivitas.'
            : 'Configure SMTP/Webhook alerts for critical CAPA & approvals, and inspect activity logs.'}
        </p>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {isAdmin && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <Bell className="w-4 h-4 text-amber-500" />
              <span>{isId ? 'Pengaturan Alert (SMTP & Webhook)' : 'Alert Channels (SMTP & Webhook)'}</span>
            </div>
            <button
              type="button"
              onClick={handleTestNotification}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isId ? 'Kirim Test' : 'Send Test'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Webhook URL</label>
              <input
                type="url"
                value={config.webhookUrl}
                onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Webhook Format</label>
              <select
                value={config.webhookType}
                onChange={(e) =>
                  setConfig({ ...config, webhookType: e.target.value as NotificationConfig['webhookType'] })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="generic">Generic JSON (WhatsApp / Custom)</option>
                <option value="slack">Slack Incoming Webhook</option>
                <option value="telegram">Telegram Bot Webhook</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP Host</label>
              <input
                type="text"
                value={config.smtpHost}
                onChange={(e) => setConfig({ ...config, smtpHost: e.target.value })}
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP Port</label>
              <input
                type="number"
                value={config.smtpPort}
                onChange={(e) => setConfig({ ...config, smtpPort: Number(e.target.value) || 587 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP User / Recipient</label>
              <input
                type="text"
                value={config.smtpUser}
                onChange={(e) => setConfig({ ...config, smtpUser: e.target.value })}
                placeholder="alerts@company.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP Password</label>
              <input
                type="password"
                value={config.smtpPass}
                onChange={(e) => setConfig({ ...config, smtpPass: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-2 text-xs text-slate-700">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.notifyOnCriticalCapa}
                onChange={(e) => setConfig({ ...config, notifyOnCriticalCapa: e.target.checked })}
              />
              <span>{isId ? 'Alert pada CAPA High / Critical' : 'Alert on High / Critical CAPA'}</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.notifyOnApproval}
                onChange={(e) => setConfig({ ...config, notifyOnApproval: e.target.checked })}
              />
              <span>{isId ? 'Alert pada Pengajuan & Approval' : 'Alert on Approval Submissions'}</span>
            </label>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center space-x-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? '...' : isId ? 'Simpan Pengaturan' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Audit Trail */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center space-x-2 text-sm font-bold text-slate-900">
          <History className="w-4 h-4 text-slate-500" />
          <span>{isId ? 'Log Audit Aktivitas (100 Terbaru)' : 'Activity Audit Trail (Latest 100)'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Actor</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    {isId ? 'Belum ada catatan audit.' : 'No audit entries yet.'}
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-semibold text-slate-800">{log.actorName}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-amber-700">{log.action}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {log.entityType} ({log.entityId})
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

