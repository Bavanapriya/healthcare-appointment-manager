import { google } from 'googleapis';
import dotenv from 'dotenv';
import prisma from '../db.js';

dotenv.config();

const client_id = process.env.GOOGLE_CLIENT_ID;
const client_secret = process.env.GOOGLE_CLIENT_SECRET;
const redirect_uri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';
const refresh_token = process.env.GOOGLE_REFRESH_TOKEN;

let oauth2Client: any = null;
let calendar: any = null;

if (client_id && client_secret && refresh_token) {
  try {
    oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
    oauth2Client.setCredentials({ refresh_token });
    calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    console.log('Google Calendar API configured successfully with OAuth2 credentials.');
  } catch (err: any) {
    console.error('Failed to configure Google Calendar client:', err.message);
  }
} else {
  console.log('Google Calendar credentials not configured. Calendar sync will run in simulated mode.');
}

interface CreateEventParams {
  doctorName: string;
  patientName: string;
  patientEmail: string;
  date: string;
  startTime: string;
  endTime?: string;
  symptoms?: string;
}

/**
 * Creates a Google Calendar event
 * Returns the event ID or a simulated ID
 */
export async function createCalendarEvent({ doctorName, patientName, patientEmail, date, startTime, endTime, symptoms }: CreateEventParams) {
  const startDateTime = `${date}T${startTime}:00`;
  const endDateTime = `${date}T${endTime || startTime}:00`;

  const eventDetails = {
    summary: `Clinic Appointment - ${doctorName} & ${patientName}`,
    description: `Appointment with Dr. ${doctorName}. Chief Symptoms: ${symptoms || 'None provided'}`,
    start: {
      dateTime: startDateTime,
      timeZone: 'UTC'
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'UTC'
    },
    attendees: [
      { email: patientEmail }
    ]
  };

  const subject = `Sync Calendar: ${eventDetails.summary}`;
  const body = JSON.stringify(eventDetails, null, 2);

  // Log to database
  const log = await prisma.notificationLog.create({
    data: {
      recipientEmail: patientEmail,
      type: 'calendar',
      subject,
      body,
      status: 'pending'
    }
  });

  if (calendar) {
    try {
      const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: eventDetails,
        sendUpdates: 'all'
      });
      
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent' }
      });
      console.log(`Real Google Calendar event created: ${response.data.id}`);
      return response.data.id;
    } catch (error: any) {
      console.error('Failed to create real Google Calendar event:', error.message);
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', errorMessage: error.message }
      });
      // Fallback to simulated event ID so booking doesn't break
      return `mock-gcal-failed-fallback-${Date.now()}`;
    }
  } else {
    // Simulation Mode
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'sent' }
    });
    console.log(`[SIMULATED CALENDAR EVENT] Created event: ${eventDetails.summary} at ${startDateTime}`);
    return `mock-gcal-${Date.now()}`;
  }
}

/**
 * Updates a Google Calendar event
 */
export async function updateCalendarEvent(eventId: string | null, { doctorName, patientName, patientEmail, date, startTime, endTime, symptoms }: CreateEventParams) {
  if (!eventId) return;

  const startDateTime = `${date}T${startTime}:00`;
  const endDateTime = `${date}T${endTime || startTime}:00`;

  const eventDetails = {
    summary: `Clinic Appointment (RESCHEDULED) - ${doctorName} & ${patientName}`,
    description: `Rescheduled appointment with Dr. ${doctorName}. Chief Symptoms: ${symptoms || 'None provided'}`,
    start: {
      dateTime: startDateTime,
      timeZone: 'UTC'
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'UTC'
    },
    attendees: [
      { email: patientEmail }
    ]
  };

  const subject = `Reschedule Calendar Event: ${eventId}`;
  const body = JSON.stringify(eventDetails, null, 2);

  // Insert log
  const log = await prisma.notificationLog.create({
    data: {
      recipientEmail: patientEmail,
      type: 'calendar',
      subject,
      body,
      status: 'pending'
    }
  });

  if (calendar && !eventId.startsWith('mock-')) {
    try {
      await calendar.events.patch({
        calendarId: 'primary',
        eventId: eventId,
        resource: eventDetails,
        sendUpdates: 'all'
      });
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent' }
      });
      console.log(`Real Google Calendar event updated: ${eventId}`);
    } catch (error: any) {
      console.error(`Failed to update real Google Calendar event ${eventId}:`, error.message);
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', errorMessage: error.message }
      });
    }
  } else {
    // Simulation Mode
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'sent' }
    });
    console.log(`[SIMULATED CALENDAR EVENT] Updated event ${eventId}: ${eventDetails.summary} at ${startDateTime}`);
  }
}

/**
 * Deletes a Google Calendar event
 */
export async function deleteCalendarEvent(eventId: string | null, patientEmail: string | null) {
  if (!eventId) return;

  const subject = `Delete Calendar Event: ${eventId}`;
  const body = `Cancellation request for Google Calendar Event ID: ${eventId}`;

  // Insert log
  const log = await prisma.notificationLog.create({
    data: {
      recipientEmail: patientEmail || 'patient@example.com',
      type: 'calendar',
      subject,
      body,
      status: 'pending'
    }
  });

  if (calendar && !eventId.startsWith('mock-')) {
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId,
        sendUpdates: 'all'
      });
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent' }
      });
      console.log(`Real Google Calendar event deleted: ${eventId}`);
    } catch (error: any) {
      console.error(`Failed to delete real Google Calendar event ${eventId}:`, error.message);
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', errorMessage: error.message }
      });
    }
  } else {
    // Simulation Mode
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'sent' }
    });
    console.log(`[SIMULATED CALENDAR EVENT] Deleted event ${eventId}`);
  }
}
