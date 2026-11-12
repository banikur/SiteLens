import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import { notificationSettings } from '../db/schema.ts';
import { requireAuth, requireRole } from '../auth/middleware.ts';
import {
  dispatchNotification,
  getEffectiveNotificationConfig,
} from '../services/notifications.ts';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.use(requireRole(['Site Manager']));

const MASKED_PASS = '••••••••';

notificationsRouter.get('/settings', async (_req: Request, res: Response) => {
  const cfg = await getEffectiveNotificationConfig();
  res.json({
    settings: {
      ...cfg,
      smtpPass: cfg.smtpPass ? MASKED_PASS : '',
    },
  });
});

notificationsRouter.put('/settings', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const body = req.body ?? {};
  const existing = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.id, 'default'))
    .limit(1);

  const resolvedPass =
    body.smtpPass === MASKED_PASS
      ? existing[0]?.smtpPass ?? null
      : body.smtpPass || null;

  const [saved] = await db
    .insert(notificationSettings)
    .values({
      id: 'default',
      smtpHost: body.smtpHost || null,
      smtpPort: Number(body.smtpPort) || 587,
      smtpUser: body.smtpUser || null,
      smtpPass: resolvedPass,
      smtpFrom: body.smtpFrom || null,
      webhookUrl: body.webhookUrl || null,
      webhookType: body.webhookType || 'generic',
      notifyOnCriticalCapa: Boolean(body.notifyOnCriticalCapa ?? true),
      notifyOnApproval: Boolean(body.notifyOnApproval ?? true),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationSettings.id,
      set: {
        smtpHost: body.smtpHost || null,
        smtpPort: Number(body.smtpPort) || 587,
        smtpUser: body.smtpUser || null,
        smtpPass: resolvedPass,
        smtpFrom: body.smtpFrom || null,
        webhookUrl: body.webhookUrl || null,
        webhookType: body.webhookType || 'generic',
        notifyOnCriticalCapa: Boolean(body.notifyOnCriticalCapa ?? true),
        notifyOnApproval: Boolean(body.notifyOnApproval ?? true),
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json({
    settings: {
      ...saved,
      smtpPass: saved.smtpPass ? MASKED_PASS : '',
    },
  });
});

notificationsRouter.post('/test', async (req: Request, res: Response) => {
  const result = await dispatchNotification({
    eventType: 'test',
    title: 'SiteLens Test Notification',
    message: `Triggered by ${req.authUser?.name || 'Admin'} to verify SMTP / Webhook delivery.`,
  });
  res.json(result);
});

