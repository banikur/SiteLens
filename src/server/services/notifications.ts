import nodemailer from 'nodemailer';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import { notificationSettings } from '../db/schema.ts';

export type NotificationEventType = 'critical_capa' | 'approval' | 'test';

export interface NotificationPayload {
  eventType: NotificationEventType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

export async function getEffectiveNotificationConfig() {
  const db = getDb();
  let row: typeof notificationSettings.$inferSelect | undefined;

  if (db) {
    const rows = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.id, 'default'))
      .limit(1);
    row = rows[0];
  }

  return {
    smtpHost: row?.smtpHost || process.env.SMTP_HOST || '',
    smtpPort: row?.smtpPort || Number(process.env.SMTP_PORT || 587),
    smtpUser: row?.smtpUser || process.env.SMTP_USER || '',
    smtpPass: row?.smtpPass || process.env.SMTP_PASS || '',
    smtpFrom: row?.smtpFrom || process.env.SMTP_FROM || 'SiteLens Alerts <noreply@sitelens.local>',
    webhookUrl: row?.webhookUrl || process.env.WEBHOOK_URL || '',
    webhookType: row?.webhookType || 'generic',
    notifyOnCriticalCapa: row?.notifyOnCriticalCapa ?? true,
    notifyOnApproval: row?.notifyOnApproval ?? true,
  };
}

export async function dispatchNotification(payload: NotificationPayload): Promise<{
  webhookSent: boolean;
  emailSent: boolean;
  errors: string[];
}> {
  const result = { webhookSent: false, emailSent: false, errors: [] as string[] };
  try {
    const cfg = await getEffectiveNotificationConfig();

    if (payload.eventType === 'critical_capa' && !cfg.notifyOnCriticalCapa) {
      return result;
    }
    if (payload.eventType === 'approval' && !cfg.notifyOnApproval) {
      return result;
    }

    // 1. Webhook dispatch (Slack / Telegram / Generic)
    if (cfg.webhookUrl) {
      try {
        const textBody = `*${payload.title}*\n${payload.message}`;
        const body =
          cfg.webhookType === 'slack'
            ? { text: textBody }
            : cfg.webhookType === 'telegram'
            ? { text: textBody, parse_mode: 'Markdown' }
            : {
                event: payload.eventType,
                title: payload.title,
                message: payload.message,
                metadata: payload.metadata || {},
                timestamp: new Date().toISOString(),
              };

        const resp = await fetch(cfg.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          result.errors.push(`Webhook HTTP ${resp.status}`);
        } else {
          result.webhookSent = true;
        }
      } catch (err: any) {
        result.errors.push(`Webhook error: ${err?.message || 'failed'}`);
      }
    }

    // 2. SMTP Email dispatch
    if (cfg.smtpHost && cfg.smtpUser) {
      try {
        const transporter = nodemailer.createTransport({
          host: cfg.smtpHost,
          port: cfg.smtpPort,
          secure: cfg.smtpPort === 465,
          auth: cfg.smtpPass
            ? { user: cfg.smtpUser, pass: cfg.smtpPass }
            : undefined,
        });

        await transporter.sendMail({
          from: cfg.smtpFrom,
          to: cfg.smtpUser,
          subject: `[SiteLens] ${payload.title}`,
          text: `${payload.title}\n\n${payload.message}\n\nTimestamp: ${new Date().toISOString()}`,
        });
        result.emailSent = true;
      } catch (err: any) {
        result.errors.push(`SMTP error: ${err?.message || 'failed'}`);
      }
    }
  } catch (err: any) {
    result.errors.push(err?.message || 'Notification dispatch failed');
  }

  return result;
}

