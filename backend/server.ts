import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import prisma from './db.js';
import { generateToken, authenticateToken, requireRole, AuthenticatedRequest, UserPayload } from './services/auth.js';
import { getPreVisitSummary, getPostVisitSummary } from './services/llm.js';
import { sendEmail } from './services/email.js';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from './services/calendar.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Setup in-memory server log stream for Simulation Panel
interface BackendLog {
  timestamp: string;
  message: string;
  type: 'info' | 'error';
}

declare global {
  var backendLogs: BackendLog[];
}

global.backendLogs = [];
const originalLog = console.log;
const originalError = console.error;

console.log = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  originalLog.apply(console, args);
  global.backendLogs.push({ timestamp: new Date().toLocaleTimeString(), message, type: 'info' });
  if (global.backendLogs.length > 100) global.backendLogs.shift();
};

console.error = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  originalError.apply(console, args);
  global.backendLogs.push({ timestamp: new Date().toLocaleTimeString(), message, type: 'error' });
  if (global.backendLogs.length > 100) global.backendLogs.shift();
};

app.use(cors());
app.use(express.json());

// Public health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', time: new Date() });
});

// Authentication Routes
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Missing email, password, or name' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: hash,
        name,
        role: 'patient'
      }
    });

    const userPayload: UserPayload = { id: newUser.id, email: newUser.email, role: 'patient', name: newUser.name };
    const token = generateToken(userPayload);

    res.status(201).json({ token, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role } });
  } catch (error: any) {
    if (error.message && error.message.includes('Unique constraint failed')) {
      return res.status(400).json({ error: 'Email address already registered' });
    }
    console.error('Registration failed:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role as 'patient' | 'doctor' | 'admin',
      name: user.name
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error: any) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/me', authenticateToken as any, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user });
});

// Doctor Listing and Profile Routes
app.get('/api/doctors', async (req: Request, res: Response) => {
  try {
    const doctors = await prisma.user.findMany({
      where: { role: 'doctor' },
      include: {
        doctorProfile: {
          include: {
            leaves: true
          }
        }
      }
    });
    
    const formatted = doctors.map(doc => {
      const profile = doc.doctorProfile;
      return {
        id: doc.id,
        name: doc.name,
        email: doc.email,
        specialisation: profile?.specialisation || 'General Medicine',
        working_hours_start: profile?.workingHoursStart || '09:00',
        working_hours_end: profile?.workingHoursEnd || '17:00',
        slot_duration: profile?.slotDuration || 30,
        leave_days: profile?.leaves.map(l => l.leaveDate) || []
      };
    });

    res.json(formatted);
  } catch (error: any) {
    console.error('Failed to get doctors:', error.message);
    res.status(500).json({ error: 'Failed to fetch doctor directory' });
  }
});

// Get slots for a doctor on a specific date
app.get('/api/doctors/:id/schedule', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { date } = req.query; // YYYY-MM-DD

  if (!date || typeof date !== 'string') {
    return res.status(400).json({ error: 'Missing date parameter' });
  }

  try {
    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: parseInt(id) },
      include: { leaves: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    const isLeave = profile.leaves.some(l => l.leaveDate === date);

    // If doctor is on leave, all slots are unavailable
    if (isLeave) {
      return res.json({ date, slots: [], isLeave: true });
    }

    // Generate slots
    const startStr = profile.workingHoursStart; // HH:MM
    const endStr = profile.workingHoursEnd; // HH:MM
    const duration = profile.slotDuration; // in minutes

    const slots = [];
    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    let current = new Date(2000, 0, 1, startH, startM);
    const endTime = new Date(2000, 0, 1, endH, endM);

    while (current < endTime) {
      const startHStr = String(current.getHours()).padStart(2, '0');
      const startMStr = String(current.getMinutes()).padStart(2, '0');
      const slotStartTime = `${startHStr}:${startMStr}`;

      const next = new Date(current.getTime() + duration * 60 * 1000);
      const endHStr = String(next.getHours()).padStart(2, '0');
      const endMStr = String(next.getMinutes()).padStart(2, '0');
      const slotEndTime = `${endHStr}:${endMStr}`;

      slots.push({
        startTime: slotStartTime,
        endTime: slotEndTime,
        status: 'available' // default
      });

      current = next;
    }

    // Fetch booked appointments on this date
    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: parseInt(id),
        appointmentDate: date,
        status: 'booked'
      }
    });

    // Fetch active slot holds
    const now = BigInt(Date.now());
    const holds = await prisma.slotHold.findMany({
      where: {
        doctorId: parseInt(id),
        appointmentDate: date,
        expiresAt: { gt: now }
      }
    });

    // Mark slots
    const updatedSlots = slots.map(slot => {
      const isBooked = appointments.some(appt => appt.startTime === slot.startTime);
      if (isBooked) {
        return { ...slot, status: 'booked' };
      }

      const isHeld = holds.some(hold => hold.startTime === slot.startTime);
      if (isHeld) {
        return { ...slot, status: 'held' };
      }

      return slot;
    });

    res.json({ date, slots: updatedSlots, isLeave: false });
  } catch (error: any) {
    console.error('Failed to calculate slots:', error.message);
    res.status(500).json({ error: 'Internal server error calculating slots' });
  }
});

// Hold a slot
app.post('/api/slots/hold', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { doctorId, date, startTime } = req.body;
  if (!doctorId || !date || !startTime) {
    return res.status(400).json({ error: 'Missing doctorId, date, or startTime' });
  }

  try {
    // Check if slot is already booked
    const isBooked = await prisma.appointment.findFirst({
      where: {
        doctorId: parseInt(doctorId),
        appointmentDate: date,
        startTime: startTime,
        status: 'booked'
      }
    });
    if (isBooked) {
      return res.status(400).json({ error: 'This slot is already booked.' });
    }

    const now = BigInt(Date.now());
    const isHeld = await prisma.slotHold.findFirst({
      where: {
        doctorId: parseInt(doctorId),
        appointmentDate: date,
        startTime: startTime,
        expiresAt: { gt: now }
      }
    });
    if (isHeld) {
      return res.status(400).json({ error: 'This slot is temporarily held by another patient. Try again shortly.' });
    }

    // Place a hold for 5 minutes
    const holdToken = `hold_${Math.random().toString(36).substring(2, 11)}`;
    const expiresAt = now + BigInt(5 * 60 * 1000); // 5 mins

    await prisma.slotHold.create({
      data: {
        doctorId: parseInt(doctorId),
        appointmentDate: date,
        startTime,
        holdToken,
        expiresAt
      }
    });

    console.log(`[Slot Hold] Put 5min hold on Doctor ${doctorId} slot ${date} ${startTime}. Token: ${holdToken}`);
    res.json({ holdToken, expiresAt: Number(expiresAt) });
  } catch (error: any) {
    if (error.message && error.message.includes('Unique constraint failed')) {
      return res.status(400).json({ error: 'This slot was just selected by another patient. Please choose another.' });
    }
    console.error('Hold slot failed:', error.message);
    res.status(500).json({ error: 'Failed to hold slot' });
  }
});

// Book an appointment
app.post('/api/appointments', authenticateToken as any, requireRole(['patient']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const { doctorId, date, startTime, endTime, symptoms, holdToken } = req.body;
  const patientId = req.user!.id;

  if (!doctorId || !date || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing appointment scheduling parameters' });
  }

  try {
    // Prevent double booking
    const doubleBooked = await prisma.appointment.findFirst({
      where: {
        doctorId: parseInt(doctorId),
        appointmentDate: date,
        startTime: startTime,
        status: 'booked'
      }
    });
    if (doubleBooked) {
      return res.status(400).json({ error: 'This slot is already booked.' });
    }

    // Create appointment and nested SymptomForm + PreVisitSummary placeholder
    const appt = await prisma.appointment.create({
      data: {
        patientId,
        doctorId: parseInt(doctorId),
        appointmentDate: date,
        startTime,
        endTime,
        status: 'booked',
        symptomForm: {
          create: { symptoms: symptoms || '' }
        },
        preVisitSummary: {
          create: {
            urgency: 'Pending',
            chiefComplaint: 'Analyzing symptoms with AI...',
            suggestedQuestions: JSON.stringify([])
          }
        }
      }
    });

    // Release slot holds
    if (holdToken) {
      await prisma.slotHold.deleteMany({
        where: { holdToken }
      });
    } else {
      await prisma.slotHold.deleteMany({
        where: {
          doctorId: parseInt(doctorId),
          appointmentDate: date,
          startTime
        }
      });
    }

    // Fetch doctor name and patient email
    const doctor = await prisma.user.findUnique({ where: { id: parseInt(doctorId) } });
    const patient = await prisma.user.findUnique({ where: { id: patientId } });

    if (doctor && patient) {
      // Trigger LLM Pre-visit summary in background
      getPreVisitSummary(symptoms || '')
        .then(async (summary) => {
          await prisma.preVisitSummary.update({
            where: { appointmentId: appt.id },
            data: {
              urgency: summary.urgency,
              chiefComplaint: summary.chiefComplaint,
              suggestedQuestions: JSON.stringify(summary.suggestedQuestions)
            }
          });
          console.log(`[AI LLM] Generated pre-visit summary for appt ID ${appt.id}. Urgency: ${summary.urgency}`);
        })
        .catch((e: any) => console.error('LLM Pre-visit summary update failed:', e.message));

      // Sync to Google Calendar in background
      createCalendarEvent({
        doctorName: doctor.name,
        patientName: patient.name,
        patientEmail: patient.email,
        date,
        startTime,
        endTime,
        symptoms
      }).then(async (gEventId) => {
        if (gEventId) {
          await prisma.appointment.update({
            where: { id: appt.id },
            data: { googleCalendarEventId: gEventId }
          });
        }
      }).catch((e: any) => console.error('Google Calendar Sync failed:', e.message));

      // Send confirmation emails
      const emailSubject = `Appointment Confirmed: Dr. ${doctor.name} on ${date}`;
      const emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #4f46e5; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">Clinic Appointment Confirmation</h2>
          <p>Dear <strong>${patient.name}</strong>,</p>
          <p>Your appointment has been successfully scheduled with details below:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #4b5563;">Doctor:</td>
              <td style="padding: 8px 0;">Dr. ${doctor.name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #4b5563;">Date:</td>
              <td style="padding: 8px 0;">${date}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #4b5563;">Time:</td>
              <td style="padding: 8px 0;">${startTime} - ${endTime}</td>
            </tr>
          </table>
          <p>We look forward to seeing you. If you need to cancel or reschedule, please do so at least 24 hours in advance.</p>
          <p style="font-size: 13px; color: #6b7280; margin-top: 30px;">This is an automated notification. Please do not reply.</p>
        </div>
      `;
      sendEmail({ to: patient.email, subject: emailSubject, html: emailBody });
      sendEmail({ 
        to: doctor.email, 
        subject: `New Appointment Booked: ${patient.name} on ${date}`, 
        html: `<p>Dear Dr. ${doctor.name}, you have a new appointment with <strong>${patient.name}</strong> on <strong>${date}</strong> from <strong>${startTime} to ${endTime}</strong>. Symptoms: ${symptoms || 'none'}</p>`
      });
    }

    res.status(201).json({ appointmentId: appt.id, message: 'Appointment booked successfully' });
  } catch (error: any) {
    console.error('Booking failed:', error.message);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// Get patient's appointments
app.get('/api/appointments/patient', authenticateToken as any, requireRole(['patient']) as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const appts = await prisma.appointment.findMany({
      where: { patientId: req.user!.id },
      include: {
        doctor: {
          include: {
            doctorProfile: true
          }
        },
        symptomForm: true,
        preVisitSummary: true,
        postVisitNote: true,
        prescription: true
      },
      orderBy: [
        { appointmentDate: 'desc' },
        { startTime: 'desc' }
      ]
    });
    
    const formatted = appts.map(a => {
      let questions: string[] = [];
      try {
        questions = a.preVisitSummary?.suggestedQuestions ? JSON.parse(a.preVisitSummary.suggestedQuestions) : [];
      } catch (err) {}

      return {
        id: a.id,
        patient_id: a.patientId,
        doctor_id: a.doctorId,
        appointment_date: a.appointmentDate,
        start_time: a.startTime,
        end_time: a.endTime,
        status: a.status,
        symptoms: a.symptomForm?.symptoms || '',
        pre_visit_urgency: a.preVisitSummary?.urgency || null,
        pre_visit_summary: a.preVisitSummary 
          ? `**Chief Complaint:** ${a.preVisitSummary.chiefComplaint}\n\n**Suggested Questions for Doctor:**\n${questions.map((q: string) => `- ${q}`).join('\n')}`
          : null,
        post_visit_notes: a.postVisitNote?.notes || null,
        prescription: a.prescription ? `${a.prescription.drug} (${a.prescription.dosage}, ${a.prescription.frequency}) for ${a.prescription.duration}` : null,
        post_visit_summary: a.postVisitNote ? a.prescription?.drug : null, // Fallback placeholder or actual LLM post summary
        google_calendar_event_id: a.googleCalendarEventId,
        doctor_name: a.doctor.name,
        specialisation: a.doctor.doctorProfile?.specialisation || 'General Medicine'
      };
    });

    res.json(formatted);
  } catch (error: any) {
    console.error('Failed to get patient appointments:', error.message);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get doctor's appointments
app.get('/api/appointments/doctor', authenticateToken as any, requireRole(['doctor']) as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const appts = await prisma.appointment.findMany({
      where: { doctorId: req.user!.id },
      include: {
        patient: true,
        symptomForm: true,
        preVisitSummary: true,
        postVisitNote: true,
        prescription: true
      },
      orderBy: [
        { appointmentDate: 'desc' },
        { startTime: 'desc' }
      ]
    });

    const formatted = appts.map(a => {
      let questions: string[] = [];
      try {
        questions = a.preVisitSummary?.suggestedQuestions ? JSON.parse(a.preVisitSummary.suggestedQuestions) : [];
      } catch (err) {}

      return {
        id: a.id,
        patient_id: a.patientId,
        doctor_id: a.doctorId,
        appointment_date: a.appointmentDate,
        start_time: a.startTime,
        end_time: a.endTime,
        status: a.status,
        symptoms: a.symptomForm?.symptoms || '',
        pre_visit_urgency: a.preVisitSummary?.urgency || null,
        pre_visit_summary: a.preVisitSummary 
          ? `**Chief Complaint:** ${a.preVisitSummary.chiefComplaint}\n\n**Suggested Questions for Doctor:**\n${questions.map((q: string) => `- ${q}`).join('\n')}`
          : null,
        post_visit_notes: a.postVisitNote?.notes || null,
        prescription: a.prescription ? `${a.prescription.drug} (${a.prescription.dosage}, ${a.prescription.frequency}) for ${a.prescription.duration}` : null,
        post_visit_summary: a.postVisitNote ? a.prescription?.drug : null,
        google_calendar_event_id: a.googleCalendarEventId,
        patient_name: a.patient.name,
        patient_email: a.patient.email
      };
    });

    res.json(formatted);
  } catch (error: any) {
    console.error('Failed to get doctor appointments:', error.message);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Cancel appointment
app.post('/api/appointments/:id/cancel', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: parseInt(id) },
      include: { patient: true, doctor: true }
    });

    if (!appt) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (req.user!.role === 'patient' && appt.patientId !== req.user!.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (req.user!.role === 'doctor' && appt.doctorId !== req.user!.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (appt.status === 'cancelled') {
      return res.status(400).json({ error: 'Appointment is already cancelled' });
    }

    await prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'cancelled' }
    });

    // Delete calendar event in background
    if (appt.googleCalendarEventId) {
      deleteCalendarEvent(appt.googleCalendarEventId, appt.patient.email)
        .catch((e: any) => console.error('Failed to delete Google Calendar event:', e.message));
    }

    // Send emails
    const emailSubject = `Appointment Cancelled: Dr. ${appt.doctor.name} on ${appt.appointmentDate}`;
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #ef4444; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">Appointment Cancelled</h2>
        <p>Dear <strong>${appt.patient.name}</strong>,</p>
        <p>This is to confirm that the appointment with Dr. <strong>${appt.doctor.name}</strong> scheduled for <strong>${appt.appointmentDate}</strong> at <strong>${appt.startTime}</strong> has been cancelled.</p>
        <p>If you did not request this change, or would like to schedule a new appointment, please log in to your patient portal.</p>
      </div>
    `;
    sendEmail({ to: appt.patient.email, subject: emailSubject, html: emailBody });
    sendEmail({ 
      to: appt.doctor.email, 
      subject: `Appointment Cancelled: ${appt.patient.name} on ${appt.appointmentDate}`,
      html: `<p>Dear Dr. ${appt.doctor.name}, your appointment with ${appt.patient.name} on ${appt.appointmentDate} at ${appt.startTime} has been cancelled.</p>`
    });

    console.log(`[Cancellation] Appointment ID ${id} cancelled by ${req.user!.name}`);
    res.json({ message: 'Appointment cancelled successfully' });
  } catch (error: any) {
    console.error('Cancellation failed:', error.message);
    res.status(500).json({ error: 'Failed to cancel appointment' });
  }
});

// Reschedule appointment
app.post('/api/appointments/:id/reschedule', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { date, startTime, endTime } = req.body;

  if (!date || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing rescheduled date or time parameters' });
  }

  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: parseInt(id) },
      include: { patient: true, doctor: true, symptomForm: true }
    });

    if (!appt) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (req.user!.role === 'patient' && appt.patientId !== req.user!.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Verify double booking
    const doubleBooked = await prisma.appointment.findFirst({
      where: {
        doctorId: appt.doctorId,
        appointmentDate: date,
        startTime: startTime,
        status: 'booked',
        id: { not: appt.id }
      }
    });
    if (doubleBooked) {
      return res.status(400).json({ error: 'This slot is already booked.' });
    }

    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        appointmentDate: date,
        startTime: startTime,
        endTime: endTime,
        status: 'booked'
      }
    });

    // Update calendar event in background
    if (appt.googleCalendarEventId) {
      updateCalendarEvent(appt.googleCalendarEventId, {
        doctorName: appt.doctor.name,
        patientName: appt.patient.name,
        patientEmail: appt.patient.email,
        date,
        startTime,
        endTime,
        symptoms: appt.symptomForm?.symptoms || ''
      }).catch((e: any) => console.error('Failed to reschedule Google Calendar event:', e.message));
    }

    // Send emails
    const emailSubject = `Appointment Rescheduled: Dr. ${appt.doctor.name} on ${date}`;
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #4f46e5; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">Appointment Rescheduled</h2>
        <p>Dear <strong>${appt.patient.name}</strong>,</p>
        <p>Your appointment with Dr. <strong>${appt.doctor.name}</strong> has been rescheduled. New details below:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #4b5563;">Date:</td>
            <td style="padding: 8px 0;">${date} (Previous: ${appt.appointmentDate})</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #4b5563;">Time:</td>
            <td style="padding: 8px 0;">${startTime} - ${endTime} (Previous: ${appt.startTime})</td>
          </tr>
        </table>
      </div>
    `;
    sendEmail({ to: appt.patient.email, subject: emailSubject, html: emailBody });
    sendEmail({ 
      to: appt.doctor.email, 
      subject: `Appointment Rescheduled: ${appt.patient.name} to ${date}`,
      html: `<p>Dear Dr. ${appt.doctor.name}, your appointment with ${appt.patient.name} has been rescheduled to <strong>${date}</strong> from <strong>${startTime} to ${endTime}</strong>.</p>`
    });

    console.log(`[Rescheduled] Appointment ID ${id} rescheduled to ${date} ${startTime}`);
    res.json({ message: 'Appointment rescheduled successfully' });
  } catch (error: any) {
    console.error('Rescheduling failed:', error.message);
    res.status(500).json({ error: 'Failed to reschedule appointment' });
  }
});

// Complete Appointment (Doctor inputs notes and prescription)
app.post('/api/appointments/:id/complete', authenticateToken as any, requireRole(['doctor']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { notes, prescription, reminders } = req.body; // reminders = array of { name, frequency }

  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: parseInt(id) },
      include: { patient: true, doctor: true }
    });

    if (!appt) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (appt.doctorId !== req.user!.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Set appointment complete and create PostVisitNote + Prescription
    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appt.id },
        data: { status: 'completed' }
      }),
      prisma.postVisitNote.upsert({
        where: { appointmentId: appt.id },
        update: { notes: notes || '' },
        create: { appointmentId: appt.id, notes: notes || '' }
      }),
      prisma.prescription.upsert({
        where: { appointmentId: appt.id },
        update: {
          drug: prescription || 'None',
          dosage: 'Standard',
          frequency: 'As instructed',
          duration: '5 days'
        },
        create: {
          appointmentId: appt.id,
          drug: prescription || 'None',
          dosage: 'Standard',
          frequency: 'As instructed',
          duration: '5 days'
        }
      })
    ]);

    // Save medication reminders if specified
    if (reminders && Array.isArray(reminders)) {
      for (const item of reminders) {
        if (item.name && item.frequency) {
          const nextSend = BigInt(Date.now() + 30 * 1000); // 30s sim
          await prisma.medicationReminder.create({
            data: {
              appointmentId: appt.id,
              patientId: appt.patientId,
              medicationName: item.name,
              frequency: item.frequency,
              nextSend,
              status: 'active'
            }
          });
          console.log(`[Scheduler] Registered medication reminder: ${item.name} for Patient ${appt.patientId}`);
        }
      }
    }

    // Trigger AI summary in background
    getPostVisitSummary(notes || '', prescription || '')
      .then(async (summary) => {
        // We will store the post-visit summary in pre_visit_summaries as a quick reuse or log it
        // To keep the original schema matching the frontend payload, we can simply simulate emailing it
        console.log(`[AI LLM] Post-visit patient summary generated for appt ID ${id}`);

        // Email summary to patient
        const emailSubject = `Post-Visit Summary & Care Plan: Dr. ${appt.doctor.name}`;
        const emailBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #7c3aed; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">Your Patient Care Plan</h2>
            <p>Dear <strong>${appt.patient.name}</strong>,</p>
            <p>Dr. <strong>${appt.doctor.name}</strong> has completed your visit notes. Below is your AI-synthesized care summary:</p>
            <div style="background-color: #faf5ff; border: 1px solid #e9d5ff; padding: 15px; border-radius: 6px; white-space: pre-wrap;">${summary}</div>
            <p style="margin-top: 20px;">If you have any active prescriptions, you will receive automated reminders on your email according to the medication schedules.</p>
          </div>
        `;
        sendEmail({ to: appt.patient.email, subject: emailSubject, html: emailBody });
      })
      .catch((e: any) => console.error('LLM Post-visit summary generation failed:', e.message));

    res.json({ message: 'Appointment marked as completed. Care plan summary generating.' });
  } catch (error: any) {
    console.error('Complete appointment failed:', error.message);
    res.status(500).json({ error: 'Failed to complete appointment' });
  }
});

// Admin Panel: Create Doctor Account
app.post('/api/admin/doctors', authenticateToken as any, requireRole(['admin']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const { email, password, name, specialisation, working_hours_start, working_hours_end, slot_duration } = req.body;
  if (!email || !password || !name || !specialisation || !working_hours_start || !working_hours_end || !slot_duration) {
    return res.status(400).json({ error: 'Missing doctor configuration parameter' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: hash,
        name,
        role: 'doctor',
        doctorProfile: {
          create: {
            specialisation,
            workingHoursStart: working_hours_start,
            workingHoursEnd: working_hours_end,
            slotDuration: parseInt(slot_duration)
          }
        }
      }
    });

    console.log(`[Admin] Created Doctor Account: Dr. ${name} (${specialisation})`);
    res.status(201).json({ doctorId: newUser.id, message: 'Doctor profile created successfully' });
  } catch (error: any) {
    if (error.message && error.message.includes('Unique constraint failed')) {
      return res.status(400).json({ error: 'Email address already in use' });
    }
    console.error('Admin create doctor failed:', error.message);
    res.status(500).json({ error: 'Internal server error creating doctor' });
  }
});

// Admin/Doctor Update Profile (including leave days conflict calculation)
app.put('/api/admin/doctors/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { specialisation, working_hours_start, working_hours_end, slot_duration, leave_days } = req.body;

  try {
    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: parseInt(id) },
      include: { leaves: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    if (req.user!.role === 'doctor' && profile.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Unauthorized to modify this profile' });
    }

    const oldLeave = profile.leaves.map(l => l.leaveDate);
    const newLeave: string[] = Array.isArray(leave_days) ? leave_days : JSON.parse(leave_days || '[]');

    // Update basic doctor profile settings
    await prisma.doctorProfile.update({
      where: { userId: parseInt(id) },
      data: {
        specialisation: specialisation || profile.specialisation,
        workingHoursStart: working_hours_start || profile.workingHoursStart,
        workingHoursEnd: working_hours_end || profile.workingHoursEnd,
        slotDuration: slot_duration ? parseInt(slot_duration) : profile.slotDuration
      }
    });

    // Handle leave day changes
    const addedLeaveDates = newLeave.filter(date => !oldLeave.includes(date));
    const removedLeaveDates = oldLeave.filter(date => !newLeave.includes(date));

    // Remove deleted leaves
    if (removedLeaveDates.length > 0) {
      await prisma.doctorLeave.deleteMany({
        where: {
          doctorProfileId: profile.id,
          leaveDate: { in: removedLeaveDates }
        }
      });
    }

    // Insert added leaves
    if (addedLeaveDates.length > 0) {
      await prisma.doctorLeave.createMany({
        data: addedLeaveDates.map(date => ({
          doctorProfileId: profile.id,
          leaveDate: date
        }))
      });

      // Handle conflicts: Cancel overlapping appointments on those new leave days
      const conflictingAppts = await prisma.appointment.findMany({
        where: {
          doctorId: parseInt(id),
          appointmentDate: { in: addedLeaveDates },
          status: 'booked'
        },
        include: { patient: true, doctor: true }
      });

      for (const appt of conflictingAppts) {
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { status: 'cancelled' }
        });
        console.log(`[Leave Conflict] Cancelled appointment ID ${appt.id} on ${appt.appointmentDate} due to Doctor leave.`);

        // Delete Google calendar event in background
        if (appt.googleCalendarEventId) {
          deleteCalendarEvent(appt.googleCalendarEventId, appt.patient.email)
            .catch((e: any) => console.error('Failed to delete Google Calendar event for leave cancellation:', e.message));
        }

        // Email notification to patient
        const emailSubject = `APPOINTMENT CANCELLATION: Dr. ${appt.doctor.name} is on Leave`;
        const emailBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #fecaca; border-radius: 8px; background-color: #fef2f2;">
            <h2 style="color: #dc2626; border-bottom: 2px solid #fee2e2; padding-bottom: 10px;">Appointment Cancelled Due to Doctor Absence</h2>
            <p>Dear <strong>${appt.patient.name}</strong>,</p>
            <p>We regret to inform you that your appointment with Dr. <strong>${appt.doctor.name}</strong> on <strong>${appt.appointmentDate}</strong> at <strong>${appt.startTime}</strong> has been cancelled.</p>
            <p>This is because Dr. ${appt.doctor.name} has scheduled leave on this date. We apologize for the inconvenience this may cause you.</p>
            <div style="margin: 20px 0; padding: 15px; border: 1px solid #fca5a5; background-color: #fff; border-radius: 6px;">
              <p style="margin: 0;"><strong>Action Required:</strong> Please log in to the Patient Portal to reschedule your visit or select a different provider.</p>
            </div>
            <p style="font-size: 12px; color: #7f1d1d;">For urgent matters, please contact the clinic front desk directly.</p>
          </div>
        `;
        sendEmail({ to: appt.patient.email, subject: emailSubject, html: emailBody });
      }
    }

    console.log(`[Profile Update] Updated Doctor Profile ${id}. Processed ${addedLeaveDates.length} new leave dates.`);
    res.json({ message: 'Profile updated successfully and leave conflict checks completed.' });
  } catch (error: any) {
    console.error('Update doctor profile failed:', error.message);
    res.status(500).json({ error: 'Failed to update doctor profile' });
  }
});

// Admin Dashboard: Fetch all doctor accounts with profiles
app.get('/api/admin/doctors', authenticateToken as any, requireRole(['admin']) as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const doctors = await prisma.user.findMany({
      where: { role: 'doctor' },
      include: {
        doctorProfile: {
          include: {
            leaves: true
          }
        }
      }
    });

    const formatted = doctors.map(doc => {
      const profile = doc.doctorProfile;
      return {
        id: doc.id,
        name: doc.name,
        email: doc.email,
        specialisation: profile?.specialisation || 'General Medicine',
        working_hours_start: profile?.workingHoursStart || '09:00',
        working_hours_end: profile?.workingHoursEnd || '17:00',
        slot_duration: profile?.slotDuration || 30,
        leave_days: profile?.leaves.map(l => l.leaveDate) || []
      };
    });

    res.json(formatted);
  } catch (error: any) {
    console.error('Admin fetch doctors failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch doctor accounts' });
  }
});

// Simulation Panel Endpoints
app.get('/api/simulation/logs', authenticateToken as any, (req: AuthenticatedRequest, res: Response) => {
  res.json(global.backendLogs);
});

app.get('/api/simulation/emails', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const emails = await prisma.notificationLog.findMany({
      where: { type: 'email' },
      orderBy: { createdAt: 'desc' }
    });
    res.json(emails);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/simulation/calendar', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const calendarEvents = await prisma.notificationLog.findMany({
      where: { type: 'calendar' },
      orderBy: { createdAt: 'desc' }
    });
    res.json(calendarEvents);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/simulation/scheduler', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const activeHolds = await prisma.slotHold.findMany({
      orderBy: { expiresAt: 'asc' }
    });
    const activeHoldsFormatted = activeHolds.map(h => ({
      id: h.id,
      doctor_id: h.doctorId,
      appointment_date: h.appointmentDate,
      start_time: h.startTime,
      hold_token: h.holdToken,
      expires_at: Number(h.expiresAt)
    }));

    const reminders = await prisma.medicationReminder.findMany({
      include: { patient: true },
      orderBy: { nextSend: 'asc' }
    });
    const remindersFormatted = reminders.map(r => ({
      id: r.id,
      appointment_id: r.appointmentId,
      patient_id: r.patientId,
      medication_name: r.medicationName,
      frequency: r.frequency,
      last_sent: r.lastSent,
      next_send: Number(r.nextSend),
      status: r.status,
      patient_name: r.patient.name
    }));

    res.json({ activeHolds: activeHoldsFormatted, reminders: remindersFormatted });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to trigger manual tick of scheduler
app.post('/api/simulation/trigger-tick', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  console.log('[Manual Simulation Tick] Forcing background scheduler execution...');
  try {
    // 1. clean slot holds
    const now = BigInt(Date.now());
    const holdsDeleted = await prisma.slotHold.deleteMany({
      where: { expiresAt: { lt: now } }
    });
    if (holdsDeleted.count > 0) {
      console.log(`[Manual Tick] Cleaned up ${holdsDeleted.count} expired slot holds.`);
    }

    // 2. retry failed notification emails
    const failedLogs = await prisma.notificationLog.findMany({
      where: { status: 'failed', retryCount: { lt: 3 }, type: 'email' }
    });
    let retriedCount = 0;
    for (const log of failedLogs) {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { retryCount: { increment: 1 } }
      });
      const resSend = await sendEmail({ to: log.recipientEmail, subject: log.subject, html: log.body });
      if (resSend.success) {
        await prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: 'sent', errorMessage: null }
        });
        retriedCount++;
      } else {
        await prisma.notificationLog.update({
          where: { id: log.id },
          data: { errorMessage: resSend.error || 'Failed' }
        });
      }
    }

    // 3. send medication reminders
    const reminders = await prisma.medicationReminder.findMany({
      where: { status: 'active', nextSend: { lte: now } },
      include: { patient: true }
    });
    
    let remindersCount = 0;
    for (const reminder of reminders) {
      await sendEmail({
        to: reminder.patient.email,
        subject: `Medication Reminder: Take your ${reminder.medicationName}`,
        html: `<p>Friendly reminder to take ${reminder.medicationName} (${reminder.frequency}).</p>`
      });
      // 30 seconds loop in simulation
      const nextSendTime = Date.now() + 30 * 1000;
      await prisma.medicationReminder.update({
        where: { id: reminder.id },
        data: {
          lastSent: new Date(),
          nextSend: BigInt(nextSendTime)
        }
      });
      remindersCount++;
    }

    res.json({
      success: true,
      message: `Manual check completed. Cleaned holds: ${holdsDeleted.count}, Retried emails: ${retriedCount}, Triggered reminders: ${remindersCount}`
    });
  } catch (error: any) {
    console.error('[Manual Tick Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// App startup
const server = app.listen(PORT, () => {
  console.log(`Healthcare Server running on port ${PORT}`);
  startScheduler();
});

// Graceful shutdown
process.on('SIGINT', () => {
  stopScheduler();
  server.close(() => {
    console.log('Server shut down.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  stopScheduler();
  server.close(() => {
    console.log('Server shut down.');
    process.exit(0);
  });
});
