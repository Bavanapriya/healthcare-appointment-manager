# MedVibe | Healthcare Appointment & Follow-up Manager

MedVibe is a clinic appointment portal with role-based dashboards for Patients, Doctors, and System Admins. The system features AI-driven symptom checkups, patient care plans, automated medication reminders, calendar synchronization, and transactional concurrency safeguards.

---

## 1. Directory Structure

```
healthcare project/
│
├── prisma/
│   └── schema.prisma      # Prisma schema (SQLite dev database datasource)
│
├── backend/
│   ├── services/
│   │   ├── auth.ts            # JWT role-based TypeScript middleware
│   │   ├── calendar.ts        # Google Calendar OAuth client
│   │   ├── email.ts           # Nodemailer notification service
│   │   ├── llm.ts             # Google Gemini AI services
│   │   └── scheduler.ts       # Background cleaner and node-cron runner
│   ├── db.ts                  # Prisma Client database utility
│   ├── server.ts              # Express API TypeScript server
│   ├── seed.ts                # Seeding script for default profiles
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # React dashboard views, states & Tailwind components
│   │   ├── index.css          # Tailwind directives and custom themes
│   │   └── main.tsx           # React app mount
│   ├── index.html
│   ├── tailwind.config.js     # Tailwind CSS configuration
│   ├── postcss.config.js      # PostCSS configuration
│   ├── tsconfig.json          # TypeScript compiler rules
│   └── package.json
│
├── verify_concurrency.ts  # Concurrency validation script
├── SYSTEM_DESIGN.md       # Engineering design write-up
├── .env.example           # Config template
├── .env                   # Root environment configuration
└── README.md
```

---

## 2. Setup & Running Guide

### Step 1: Configure Environment Variables
Copy `.env.example` to `.env` in the root folder (and ensure it is copied to `backend/.env`):
```bash
cp .env.example .env
```
Ensure `DATABASE_URL` is set to `"file:./dev.db"`.

### Step 2: Install Monorepo Dependencies
Install dependencies at the root and in the sub-directories:
```bash
# Root installation
cmd /c npm install

# Backend installation
cd backend
cmd /c npm install

# Frontend installation
cd ../frontend
cmd /c npm install
```

### Step 3: Run Database Migrations & Seeding
Set up the SQLite database and seed initial profiles:
```bash
# In the backend/ directory
cmd /c npx prisma migrate dev --name init --schema=../prisma/schema.prisma
cmd /c npx tsx seed.ts
```

### Step 4: Run the Development Servers
Start both servers concurrently:
```bash
# Start backend server (starts on Port 5000)
cd backend
cmd /c npm run dev

# In another terminal, start frontend server (Vite on Port 3000)
cd frontend
cmd /c npm run dev
```
Open your browser and navigate to `http://localhost:3000`.

---

## 3. Seed Accounts
You can log in immediately using these pre-configured accounts:
- **Admin**: `admin@clinic.com` / `admin123`
- **Doctor Alice (Cardiology)**: `alice@clinic.com` / `doctor123`
- **Doctor Bob (Dermatology)**: `bob@clinic.com` / `doctor123`
- **Patient**: `patient@clinic.com` / `patient123`

---

## 4. API Documentation

Versioned RESTful endpoints (`/api/v1` equivalent routed through `/api`):

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/api/auth/register` | Registers new patient account | Public |
| `POST` | `/api/auth/login` | Authenticates email/password | Public |
| `GET` | `/api/auth/me` | Fetch authenticated payload | Patient/Doctor/Admin |
| `GET` | `/api/doctors` | List doctors directory | Public |
| `GET` | `/api/doctors/:id/schedule?date=...` | Calculate slots on target date | Public |
| `POST` | `/api/slots/hold` | Place 5-minute lock hold on a slot | Patient |
| `POST` | `/api/appointments` | Finalize slot booking & trigger AI symptoms summary | Patient |
| `GET` | `/api/appointments/patient` | Get patient appointments history | Patient |
| `GET` | `/api/appointments/doctor` | Get doctor schedule agenda | Doctor |
| `POST` | `/api/appointments/:id/cancel` | Cancel booking & delete calendar event | Patient/Doctor |
| `POST` | `/api/appointments/:id/reschedule` | Reschedule booking & update event | Patient |
| `POST` | `/api/appointments/:id/complete` | Complete visit notes & write prescriptions | Doctor |
| `POST` | `/api/admin/doctors` | Register new doctor account | Admin |
| `PUT` | `/api/admin/doctors/:id` | Add leave dates (automatically handles conflicts) | Admin/Doctor |

---

## 5. Concurrency Validation Test
To verify the double-booking slot hold race-condition safety:
```bash
# Run from the workspace root directory
cmd /c npm run test:concurrency
```
The script fires two concurrent hold requests for the same slot. One successfully acquires the hold, and the other is rejected with a `Unique constraint failed` validation error.

---

## 6. Exact LLM Prompts Configuration

1. **Pre-visit Symptoms Summary**:
   - **Prompt**:
     ```
     Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor.
     You MUST respond with a valid JSON object EXACTLY in this format, with no markdown formatting tags and no extra text around:
     {
       "urgency": "Low" or "Medium" or "High",
       "chiefComplaint": "Brief explanation of the main symptom issues",
       "suggestedQuestions": ["Question 1", "Question 2", "Question 3"]
     }
     Symptoms: <symptoms>
     ```
2. **Post-visit Diagnosis Summary**:
   - **Prompt**:
     ```
     Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps:
     Clinical Notes: <notes>
     Prescription details: <prescription>
     Please write this in a warm, patient-friendly tone using clear markdown headings and bullet points.
     ```

---

## 7. Google Calendar Integration Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Calendar API**.
3. Configure OAuth Consent Screen & select External UserType.
4. Create **OAuth 2.0 Client ID** credentials:
   - Authorized redirect URI: `http://localhost:5000/api/auth/google/callback`
5. Place Client ID & Client Secret in `.env`.
6. Authorize application and generate a refresh token. Save it in `.env` as `GOOGLE_REFRESH_TOKEN`.

---

## 8. Deployment

- **Frontend (Vercel)**:
  Configure Build Command as `npm run build` and Output Directory as `dist`. Set environment variables pointing to backend API.
- **Backend & Database (Render / Railway)**:
  Connect your repo, provision a PostgreSQL database, map `DATABASE_URL` connection string to backend service, and execute server startup. Modify `prisma/schema.prisma` datasource provider to `postgresql` if running on live Postgres production databases.
