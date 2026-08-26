import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import prisma from '../db.js';

dotenv.config();

const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT || '587';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'clinic@example.com';

let transporter: nodemailer.Transporter | null = null;

if (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) {
  try {
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: parseInt(EMAIL_PORT),
      secure: EMAIL_PORT === '465',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });
    console.log('Nodemailer SMTP client configured successfully.');
  } catch (err: any) {
    console.error('Failed to configure Nodemailer SMTP client:', err.message);
  }
} else {
  console.log('SMTP credentials not configured. Email service will run in simulated log-mode.');
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Queue and/or send email. All attempts are saved in database `notification_logs`.
 * If SMTP is ready, sends it; else marks it as mock 'sent'.
 */
export async function sendEmail({ to, subject, html }: SendEmailParams) {
  // Insert initial pending log
  const log = await prisma.notificationLog.create({
    data: {
      recipientEmail: to,
      type: 'email',
      subject,
      body: html,
      status: 'pending'
    }
  });

  if (transporter) {
    try {
      await transporter.sendMail({
        from: EMAIL_FROM,
        to,
        subject,
        html
      });
      
      // Update log to sent
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent' }
      });
      console.log(`Real email sent to ${to}: ${subject}`);
      return { success: true, mode: 'smtp', logId: log.id };
    } catch (error: any) {
      console.error(`Failed to send email to ${to} via SMTP:`, error.message);
      
      // Update log to failed for scheduler retry
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: 'failed',
          errorMessage: error.message,
          retryCount: { increment: 1 }
        }
      });
      return { success: false, mode: 'smtp', error: error.message, logId: log.id };
    }
  } else {
    // Simulation Mode: Auto-approve sending and save in database for the Simulator Panel
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'sent' }
    });
    console.log(`[SIMULATED EMAIL] To: ${to} | Subject: ${subject}`);
    return { success: true, mode: 'simulation', logId: log.id };
  }
}
