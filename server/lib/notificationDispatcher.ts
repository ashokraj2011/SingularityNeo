/**
 * notificationDispatcher.ts
 *
 * Multi-channel alert delivery for ALERT workflow nodes.
 * Channels: EMAIL (nodemailer stub), SLACK (webhook), WEBHOOK (HTTP POST), IN_APP (DB).
 *
 * EMAIL and SLACK require environment variables; if missing, they log to console only.
 */
import { query as dbQuery } from '../db';
import type { WorkflowAlertConfig } from '../../src/types';

export interface AlertContext {
  workflowName: string;
  capabilityId: string;
  runId: string;
  nodeId: string;
  resolvedRecipients: string[];
}

async function sendEmail(
  config: WorkflowAlertConfig,
  context: AlertContext,
  recipients: string[],
): Promise<void> {
  const subject = `[${config.severity ?? 'INFO'}] Workflow Alert — ${context.workflowName}`;
  const body = config.messageTemplate ?? 'A workflow alert was triggered.';

  if (!process.env.SMTP_HOST) {
    console.log(
      `[NotificationDispatcher] EMAIL stub — would send to ${recipients.join(', ')}:\n  Subject: ${subject}\n  Body: ${body}`,
    );
    return;
  }

  // Dynamic import so nodemailer is optional (not in package.json yet)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodemailer = await import('nodemailer' as any);
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'noreply@singularity.local',
      to: recipients.join(', '),
      subject,
      text: body,
    });
    console.log(`[NotificationDispatcher] EMAIL sent to ${recipients.join(', ')}`);
  } catch (err) {
    console.error('[NotificationDispatcher] EMAIL failed:', err);
  }
}

async function sendSlack(config: WorkflowAlertConfig, context: AlertContext): Promise<void> {
  const webhookUrl = config.webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(
      `[NotificationDispatcher] SLACK stub — no webhook URL configured. Channel: ${config.slackChannel}`,
    );
    return;
  }

  const text = `*[${config.severity ?? 'INFO'}] ${context.workflowName}*\n${config.messageTemplate ?? ''}`;
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, channel: config.slackChannel }),
    });
    if (!response.ok) {
      console.error(`[NotificationDispatcher] SLACK returned ${response.status}`);
    }
  } catch (err) {
    console.error('[NotificationDispatcher] SLACK failed:', err);
  }
}

async function sendWebhook(config: WorkflowAlertConfig, context: AlertContext): Promise<void> {
  if (!config.webhookUrl) {
    console.log('[NotificationDispatcher] WEBHOOK stub — no webhookUrl configured');
    return;
  }

  const payload = {
    severity: config.severity,
    workflowName: context.workflowName,
    runId: context.runId,
    nodeId: context.nodeId,
    message: config.messageTemplate,
    firedAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(`[NotificationDispatcher] WEBHOOK returned ${response.status}`);
    }
  } catch (err) {
    console.error('[NotificationDispatcher] WEBHOOK failed:', err);
  }
}

async function insertInApp(config: WorkflowAlertConfig, context: AlertContext): Promise<void> {
  try {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const message = config.messageTemplate ?? `Workflow alert in ${context.workflowName}`;

    await dbQuery(
      `INSERT INTO notifications (id, run_id, capability_id, node_id, severity, message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, context.runId, context.capabilityId, context.nodeId, config.severity ?? 'INFO', message],
    );

    console.log(`[NotificationDispatcher] IN_APP notification inserted (${id})`);
  } catch (err) {
    console.error('[NotificationDispatcher] IN_APP insert failed:', err);
  }
}

export async function dispatchAlert(
  config: WorkflowAlertConfig,
  context: AlertContext,
): Promise<void> {
  const channel = config.channel ?? 'IN_APP';

  // Build final recipient list (explicit emails + resolved-from-roles)
  const recipients = [
    ...(config.recipients ?? []),
    ...context.resolvedRecipients,
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  console.log(
    `[NotificationDispatcher] dispatching ${channel} alert — severity=${config.severity}, run=${context.runId}`,
  );

  switch (channel) {
    case 'EMAIL':
      await sendEmail(config, context, recipients);
      break;
    case 'SLACK':
      await sendSlack(config, context);
      break;
    case 'WEBHOOK':
      await sendWebhook(config, context);
      break;
    case 'IN_APP':
    default:
      await insertInApp(config, context);
      break;
  }
}
