import cron from 'node-cron';
import prisma from '../db.js';
import { sendEmail } from './email.js';

let cronTask: cron.ScheduledTask | null = null;

// Determine offset for next reminder
function calculateNextSend(frequency: string): number {
  // If simulation is enabled, make reminders fire every 30 seconds for quick testing!
  const isFastSim = true; 
  if (isFastSim) {
    return Date.now() + 30 * 1000; // 30 seconds from now
  }

  // Production calculation
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  
  switch (frequency.toLowerCase()) {
    case 'twice a day':
    case 'every 12 hours':
      return now + 12 * 60 * 60 * 1000;
    case 'three times a day':
    case 'every 8 hours':
      return now + 8 * 60 * 60 * 1000;
    case 'weekly':
      return now + 7 * day;
    case 'daily':
    default:
      return now + day;
  }
}

async function processSlotHolds() {
  const now = BigInt(Date.now());
  const result = await prisma.slotHold.deleteMany({
    where: { expiresAt: { lt: now } }
  });
  if (result.count > 0) {
    console.log(`[Scheduler] Cleaned up ${result.count} expired slot holds.`);
  }
}

async function processFailedNotifications() {
  const failedNotifications = await prisma.notificationLog.findMany({
    where: {
      status: 'failed',
      retryCount: { lt: 3 },
      type: 'email'
    }
  });

  for (const log of failedNotifications) {
    console.log(`[Scheduler] Retrying notification ID ${log.id} to ${log.recipientEmail} (Attempt ${log.retryCount + 1})...`);
    
    // Increment retry count first to prevent race condition loop
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { retryCount: { increment: 1 } }
    });

    const res = await sendEmail({
      to: log.recipientEmail,
      subject: log.subject,
      html: log.body
    });

    if (res.success) {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent', errorMessage: null }
      });
      console.log(`[Scheduler] Successfully retried notification ID ${log.id}`);
    } else {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { errorMessage: res.error || 'Retry attempt failed' }
      });
      console.log(`[Scheduler] Notification ID ${log.id} retry failed.`);
    }
  }
}

async function processMedicationReminders() {
  const now = BigInt(Date.now());
  const reminders = await prisma.medicationReminder.findMany({
    where: {
      status: 'active',
      nextSend: { lte: now }
    },
    include: {
      patient: true
    }
  });

  for (const reminder of reminders) {
    console.log(`[Scheduler] Triggering medication reminder for ${reminder.patient.name}: ${reminder.medicationName}`);
    
    const emailSubject = `Medication Reminder: Take your ${reminder.medicationName}`;
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #4f46e5; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">Medication Reminder</h2>
        <p>Dear <strong>${reminder.patient.name}</strong>,</p>
        <p>This is a friendly reminder to take your prescribed medication as scheduled:</p>
        <div style="background-color: #f5f3ff; border-left: 4px solid #7c3aed; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 16px;"><strong>Medication:</strong> ${reminder.medicationName}</p>
          <p style="margin: 5px 0 0 0; font-size: 14px; color: #4b5563;"><strong>Frequency:</strong> ${reminder.frequency}</p>
        </div>
        <p style="font-size: 13px; color: #6b7280; margin-top: 30px;">
          If you have any questions or are experiencing side effects, please contact the clinic or consult your doctor.
        </p>
      </div>
    `;

    // Send email
    await sendEmail({
      to: reminder.patient.email,
      subject: emailSubject,
      html: emailBody
    });

    // Calculate next sending schedule
    const nextSendTime = calculateNextSend(reminder.frequency);

    // Update reminder record
    await prisma.medicationReminder.update({
      where: { id: reminder.id },
      data: {
        lastSent: new Date(),
        nextSend: BigInt(nextSendTime)
      }
    });
  }
}

export function startScheduler() {
  if (cronTask) return;

  console.log('Background Scheduler Service (node-cron) started.');
  
  // Tick every 10 seconds using node-cron 6-field schedule
  cronTask = cron.schedule('*/10 * * * * *', async () => {
    try {
      await processSlotHolds();
      await processFailedNotifications();
      await processMedicationReminders();
    } catch (err: any) {
      console.error('[Scheduler Error]:', err.message);
    }
  });
}

export function stopScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('Background Scheduler Service (node-cron) stopped.');
  }
}
