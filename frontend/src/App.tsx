import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  User as UserIcon, 
  Shield, 
  LogOut, 
  Plus, 
  Search, 
  Mail, 
  FileText, 
  Settings, 
  AlertTriangle, 
  CheckCircle, 
  X, 
  Activity, 
  ChevronRight, 
  Play, 
  Trash2, 
  Bell,
  RefreshCw
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'patient' | 'doctor' | 'admin';
}

interface Doctor {
  id: number;
  name: string;
  email: string;
  specialisation: string;
  working_hours_start: string;
  working_hours_end: string;
  slot_duration: number;
  leave_days: string[];
}

interface Slot {
  startTime: string;
  endTime: string;
  status: 'available' | 'booked' | 'held';
}

interface Appointment {
  id: number;
  patient_id: number;
  doctor_id: number;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: 'booked' | 'cancelled' | 'completed';
  symptoms: string;
  pre_visit_urgency: string | null;
  pre_visit_summary: string | null;
  post_visit_notes: string | null;
  prescription: string | null;
  post_visit_summary: string | null;
  google_calendar_event_id: string | null;
  doctor_name?: string;
  specialisation?: string;
  patient_name?: string;
  patient_email?: string;
}

export default function App() {
  // Auth state
  const [token, setToken] = useState<string>(localStorage.getItem('token') || '');
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authRole, setAuthRole] = useState<'patient' | 'doctor' | 'admin'>('patient');
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });
  const [authError, setAuthError] = useState<string>('');

  // App navigation
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // Directory / Doctor state
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [bookingDate, setBookingDate] = useState<string>('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [symptoms, setSymptoms] = useState<string>('');
  const [holdToken, setHoldToken] = useState<string>('');
  const [holdExpiresAt, setHoldExpiresAt] = useState<number>(0);
  const [holdTimerText, setHoldTimerText] = useState<string>('');
  const [doctorSearch, setDoctorSearch] = useState<string>('');
  const [specialisationFilter, setSpecialisationFilter] = useState<string>('');

  // Appointments
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadingAppts, setLoadingAppts] = useState<boolean>(false);
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null);

  // Doctor Action State (Notes submission)
  const [selectedApptForNotes, setSelectedApptForNotes] = useState<Appointment | null>(null);
  const [consultationNotes, setConsultationNotes] = useState<string>('');
  const [prescription, setPrescription] = useState<string>('');
  const [remindersList, setRemindersList] = useState<{ name: string; frequency: string }[]>([{ name: '', frequency: 'Daily' }]);

  // Admin Doctor Management
  const [newDoctorForm, setNewDoctorForm] = useState({
    email: '',
    password: '',
    name: '',
    specialisation: '',
    working_hours_start: '09:00',
    working_hours_end: '17:00',
    slot_duration: '30'
  });
  const [adminSelectedDoctor, setAdminSelectedDoctor] = useState<Doctor | null>(null);
  const [newLeaveDate, setNewLeaveDate] = useState<string>('');
  const [adminStatusMsg, setAdminStatusMsg] = useState({ text: '', type: '' });

  // Simulation Panel
  const [isSimOpen, setIsSimOpen] = useState<boolean>(false);
  const [simTab, setSimTab] = useState<string>('logs');
  const [simLogs, setSimLogs] = useState<any[]>([]);
  const [simEmails, setSimEmails] = useState<any[]>([]);
  const [simCalendar, setSimCalendar] = useState<any[]>([]);
  const [simScheduler, setSimScheduler] = useState<{ activeHolds: any[]; reminders: any[] }>({ activeHolds: [], reminders: [] });
  const [simTickRunning, setSimTickRunning] = useState<boolean>(false);

  // Poll intervals
  const simPollIntervalRef = useRef<any>(null);
  const holdIntervalRef = useRef<any>(null);

  // Load user data on startup
  useEffect(() => {
    if (token) {
      fetchCurrentUser();
    }
  }, [token]);

  // Load tab data
  useEffect(() => {
    if (user) {
      if (activeTab === 'doctors' || user.role === 'admin') {
        fetchDoctors();
      }
      if (activeTab === 'dashboard' || activeTab === 'appointments') {
        fetchAppointments();
      }
    }
  }, [user, activeTab]);

  // Sync Timer for Slot Hold
  useEffect(() => {
    if (holdExpiresAt > 0) {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      
      holdIntervalRef.current = setInterval(() => {
        const remaining = Math.max(0, holdExpiresAt - Date.now());
        if (remaining <= 0) {
          clearInterval(holdIntervalRef.current);
          setHoldToken('');
          setHoldExpiresAt(0);
          setHoldTimerText('');
          setSelectedSlot(null);
          alert('Your temporary slot hold has expired. Please select a slot again.');
          if (selectedDoctor && bookingDate) {
            fetchSlots(selectedDoctor.id, bookingDate);
          }
        } else {
          const mins = Math.floor(remaining / 60000);
          const secs = Math.floor((remaining % 60000) / 1000);
          setHoldTimerText(`${mins}:${String(secs).padStart(2, '0')}`);
        }
      }, 1000);
    } else {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      setHoldTimerText('');
    }

    return () => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    };
  }, [holdExpiresAt, selectedDoctor, bookingDate]);

  // Poll simulator data when drawer is open
  useEffect(() => {
    if (isSimOpen && token) {
      fetchSimData();
      simPollIntervalRef.current = setInterval(fetchSimData, 3000);
    } else {
      if (simPollIntervalRef.current) {
        clearInterval(simPollIntervalRef.current);
      }
    }
    return () => {
      if (simPollIntervalRef.current) {
        clearInterval(simPollIntervalRef.current);
      }
    };
  }, [isSimOpen, token]);

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        // Default views based on roles
        if (data.user.role === 'admin') setActiveTab('admin-doctors');
        else setActiveTab('dashboard');
      } else {
        logout();
      }
    } catch (e) {
      console.error('Fetch user failed', e);
      logout();
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setActiveTab('dashboard');
    setAppointments([]);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = authMode === 'login' ? 'login' : 'register';
    const body = authMode === 'login' 
      ? { email: authForm.email, password: authForm.password }
      : { email: authForm.email, password: authForm.password, name: authForm.name };

    try {
      const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthForm({ email: '', password: '', name: '' });
      if (data.user.role === 'admin') setActiveTab('admin-doctors');
      else setActiveTab('dashboard');
    } catch (error) {
      setAuthError('Server connection error. Ensure backend is running.');
    }
  };

  const fetchDoctors = async () => {
    try {
      const res = await fetch(`${API_BASE}/doctors`);
      const data = await res.json();
      setDoctors(data);
    } catch (e) {
      console.error('Fetch doctors failed', e);
    }
  };

  const fetchAppointments = async () => {
    if (!user) return;
    setLoadingAppts(true);
    try {
      const endpoint = user.role === 'patient' ? 'patient' : 'doctor';
      const res = await fetch(`${API_BASE}/appointments/${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setAppointments(data);
      }
    } catch (e) {
      console.error('Fetch appointments failed', e);
    } finally {
      setLoadingAppts(false);
    }
  };

  const fetchSlots = async (doctorId: number, date: string) => {
    if (!date) return;
    try {
      const res = await fetch(`${API_BASE}/doctors/${doctorId}/schedule?date=${date}`);
      const data = await res.json();
      if (res.ok) {
        setSlots(data.slots);
      }
    } catch (e) {
      console.error('Fetch slots failed', e);
    }
  };

  const handleDateChange = (date: string) => {
    setBookingDate(date);
    setSelectedSlot(null);
    if (selectedDoctor) {
      fetchSlots(selectedDoctor.id, date);
    }
  };

  const handleSelectSlot = async (slot: Slot) => {
    if (slot.status !== 'available') return;
    
    // Clear old hold
    setHoldToken('');
    setHoldExpiresAt(0);

    const docId = reschedulingAppt ? reschedulingAppt.doctor_id : selectedDoctor!.id;
    const targetDate = reschedulingAppt ? reschedulingAppt.appointment_date : bookingDate;

    try {
      const res = await fetch(`${API_BASE}/slots/hold`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          doctorId: docId,
          date: targetDate,
          startTime: slot.startTime
        })
      });

      const data = await res.json();
      if (res.ok) {
        setHoldToken(data.holdToken);
        setHoldExpiresAt(data.expiresAt);
        setSelectedSlot(slot);
      } else {
        alert(data.error || 'Failed to place hold on slot');
      }
    } catch (e) {
      console.error('Slot hold request failed', e);
    }
  };

  const bookAppointment = async () => {
    if (!selectedSlot || !selectedDoctor) return;
    try {
      const res = await fetch(`${API_BASE}/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          doctorId: selectedDoctor.id,
          date: bookingDate,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          symptoms: symptoms,
          holdToken: holdToken
        })
      });

      const data = await res.json();
      if (res.ok) {
        // Success
        setHoldToken('');
        setHoldExpiresAt(0);
        setSelectedSlot(null);
        setSymptoms('');
        setSelectedDoctor(null);
        setBookingDate('');
        setActiveTab('appointments');
        fetchAppointments();
      } else {
        alert(data.error || 'Failed to book appointment');
      }
    } catch (e) {
      console.error('Booking failed', e);
    }
  };

  const cancelAppointment = async (apptId: number) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;
    try {
      const res = await fetch(`${API_BASE}/appointments/${apptId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        fetchAppointments();
      } else {
        alert(data.error || 'Failed to cancel');
      }
    } catch (e) {
      console.error('Cancellation request failed', e);
    }
  };

  const executeReschedule = async () => {
    if (!selectedSlot || !reschedulingAppt) return;
    try {
      const res = await fetch(`${API_BASE}/appointments/${reschedulingAppt.id}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          date: reschedulingAppt.appointment_date,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime
        })
      });
      const data = await res.json();
      if (res.ok) {
        setHoldToken('');
        setHoldExpiresAt(0);
        setSelectedSlot(null);
        setReschedulingAppt(null);
        fetchAppointments();
      } else {
        alert(data.error || 'Failed to reschedule');
      }
    } catch (e) {
      console.error('Rescheduling failed', e);
    }
  };

  const startRescheduling = (appt: Appointment) => {
    setReschedulingAppt(appt);
    fetchSlots(appt.doctor_id, appt.appointment_date);
  };

  // Doctor Care notes handling
  const submitCarePlan = async () => {
    if (!selectedApptForNotes) return;
    
    // Filter out blank reminders
    const validReminders = remindersList.filter(item => item.name.trim() !== '');

    try {
      const res = await fetch(`${API_BASE}/appointments/${selectedApptForNotes.id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          notes: consultationNotes,
          prescription: prescription,
          reminders: validReminders
        })
      });

      if (res.ok) {
        setSelectedApptForNotes(null);
        setConsultationNotes('');
        setPrescription('');
        setRemindersList([{ name: '', frequency: 'Daily' }]);
        fetchAppointments();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to submit clinical notes');
      }
    } catch (e) {
      console.error('Submit care notes failed', e);
    }
  };

  // Admin doctor creation
  const handleAdminCreateDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminStatusMsg({ text: '', type: '' });
    try {
      const res = await fetch(`${API_BASE}/admin/doctors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(newDoctorForm)
      });
      const data = await res.json();
      if (res.ok) {
        setAdminStatusMsg({ text: 'Doctor account created successfully!', type: 'success' });
        setNewDoctorForm({
          email: '',
          password: '',
          name: '',
          specialisation: '',
          working_hours_start: '09:00',
          working_hours_end: '17:00',
          slot_duration: '30'
        });
        fetchDoctors();
      } else {
        setAdminStatusMsg({ text: data.error || 'Failed to create doctor account', type: 'error' });
      }
    } catch (e) {
      setAdminStatusMsg({ text: 'Failed to connect to backend.', type: 'error' });
    }
  };

  // Admin add leave date
  const handleAddLeaveDate = async () => {
    if (!newLeaveDate || !adminSelectedDoctor) return;
    setAdminStatusMsg({ text: '', type: '' });
    
    const updatedLeave = [...adminSelectedDoctor.leave_days, newLeaveDate];

    try {
      const res = await fetch(`${API_BASE}/admin/doctors/${adminSelectedDoctor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          leave_days: updatedLeave
        })
      });
      const data = await res.json();
      if (res.ok) {
        setAdminSelectedDoctor({
          ...adminSelectedDoctor,
          leave_days: updatedLeave
        });
        setNewLeaveDate('');
        setAdminStatusMsg({ text: 'Leave day added. Affected appointments cancelled, patients notified.', type: 'success' });
        fetchDoctors();
      } else {
        setAdminStatusMsg({ text: data.error || 'Failed to update leave schedule', type: 'error' });
      }
    } catch (e) {
      setAdminStatusMsg({ text: 'Connection failed.', type: 'error' });
    }
  };

  // Admin remove leave date
  const handleRemoveLeaveDate = async (dateToRemove: string) => {
    if (!adminSelectedDoctor) return;
    setAdminStatusMsg({ text: '', type: '' });
    const updatedLeave = adminSelectedDoctor.leave_days.filter(d => d !== dateToRemove);

    try {
      const res = await fetch(`${API_BASE}/admin/doctors/${adminSelectedDoctor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          leave_days: updatedLeave
        })
      });
      if (res.ok) {
        setAdminSelectedDoctor({
          ...adminSelectedDoctor,
          leave_days: updatedLeave
        });
        setAdminStatusMsg({ text: 'Leave day removed.', type: 'success' });
        fetchDoctors();
      }
    } catch (e) {
      console.error('Failed to remove leave date', e);
    }
  };

  // Fetch simulation panel details
  const fetchSimData = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [logsRes, emailsRes, calendarRes, schedulerRes] = await Promise.all([
        fetch(`${API_BASE}/simulation/logs`, { headers }),
        fetch(`${API_BASE}/simulation/emails`, { headers }),
        fetch(`${API_BASE}/simulation/calendar`, { headers }),
        fetch(`${API_BASE}/simulation/scheduler`, { headers })
      ]);

      if (logsRes.ok) setSimLogs(await logsRes.json());
      if (emailsRes.ok) setSimEmails(await emailsRes.json());
      if (calendarRes.ok) setSimCalendar(await calendarRes.json());
      if (schedulerRes.ok) setSimScheduler(await schedulerRes.json());
    } catch (e) {
      console.error('Simulation polling error:', e);
    }
  };

  const triggerSimTick = async () => {
    setSimTickRunning(true);
    try {
      const res = await fetch(`${API_BASE}/simulation/trigger-tick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      console.log('Simulation Tick triggered:', data.message);
      fetchSimData();
      fetchAppointments(); // In case patient reminders updated database view
    } catch (e) {
      console.error(e);
    } finally {
      setSimTickRunning(false);
    }
  };

  // Filter doctors directory list
  const filteredDoctors = doctors.filter(doc => {
    const nameMatch = doc.name.toLowerCase().includes(doctorSearch.toLowerCase());
    const specMatch = specialisationFilter === '' || doc.specialisation === specialisationFilter;
    return nameMatch && specMatch;
  });

  // Extract unique list of specialisations for filtering
  const uniqueSpecialisations = Array.from(new Set(doctors.map(d => d.specialisation)));

  return (
    <div className="app-container">
      {/* Auth Screen */}
      {!user ? (
        <div className="auth-wrapper">
          <div className="glass-panel auth-card">
            <div className="brand" style={{ justifyContent: 'center' }}>
              <div className="brand-logo">+</div>
              <span className="brand-name">MedVibe Hub</span>
            </div>
            
            <h2 className="auth-title">
              {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="auth-subtitle">
              {authMode === 'login' ? 'Log in to manage appointments & summaries' : 'Sign up for a patient portal account'}
            </p>

            {authError && (
              <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <AlertTriangle size={16} />
                <span>{authError}</span>
              </div>
            )}

            {authMode === 'login' && (
              <div className="auth-roles">
                <button className={`auth-role-btn ${authRole === 'patient' ? 'active' : ''}`} onClick={() => setAuthRole('patient')}>Patient</button>
                <button className={`auth-role-btn ${authRole === 'doctor' ? 'active' : ''}`} onClick={() => setAuthRole('doctor')}>Doctor</button>
                <button className={`auth-role-btn ${authRole === 'admin' ? 'active' : ''}`} onClick={() => setAuthRole('admin')}>Admin</button>
              </div>
            )}

            <form onSubmit={handleAuth}>
              {authMode === 'register' && (
                <div className="form-group">
                  <label>Full Name</label>
                  <input type="text" className="form-control" placeholder="John Doe" value={authForm.name} onChange={(e) => setAuthForm({...authForm, name: e.target.value})} required />
                </div>
              )}

              <div className="form-group">
                <label>Email Address</label>
                <input type="email" className="form-control" placeholder={authRole === 'admin' ? 'admin@clinic.com' : authRole === 'doctor' ? 'alice@clinic.com' : 'patient@clinic.com'} value={authForm.email} onChange={(e) => setAuthForm({...authForm, email: e.target.value})} required />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input type="password" className="form-control" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} required />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}>
                {authMode === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            </form>

            <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {authMode === 'login' ? (
                <>
                  Don't have a patient account?{' '}
                  <span style={{ color: 'var(--color-primary)', cursor: 'pointer', fontWeight: '600' }} onClick={() => { setAuthMode('register'); setAuthRole('patient'); }}>
                    Register here
                  </span>
                </>
              ) : (
                <>
                  Already registered?{' '}
                  <span style={{ color: 'var(--color-primary)', cursor: 'pointer', fontWeight: '600' }} onClick={() => setAuthMode('login')}>
                    Sign in here
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Main App Layout */}
          
          {/* Sidebar Navigation */}
          <div className="sidebar">
            <div className="brand">
              <div className="brand-logo">+</div>
              <span className="brand-name">MedVibe</span>
            </div>

            <div className="nav-menu">
              {user.role !== 'admin' && (
                <>
                  <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => { setActiveTab('dashboard'); setSelectedDoctor(null); setReschedulingAppt(null); }}>
                    <Activity size={18} />
                    <span>Dashboard</span>
                  </div>
                  {user.role === 'patient' && (
                    <div className={`nav-item ${activeTab === 'doctors' ? 'active' : ''}`} onClick={() => { setActiveTab('doctors'); setSelectedDoctor(null); setReschedulingAppt(null); }}>
                      <Search size={18} />
                      <span>Search Doctors</span>
                    </div>
                  )}
                  <div className={`nav-item ${activeTab === 'appointments' ? 'active' : ''}`} onClick={() => { setActiveTab('appointments'); setSelectedDoctor(null); setReschedulingAppt(null); }}>
                    <CalendarIcon size={18} />
                    <span>Appointments</span>
                  </div>
                </>
              )}

              {user.role === 'admin' && (
                <>
                  <div className={`nav-item ${activeTab === 'admin-doctors' ? 'active' : ''}`} onClick={() => setActiveTab('admin-doctors')}>
                    <Shield size={18} />
                    <span>Doctor Profiles</span>
                  </div>
                  <div className={`nav-item ${activeTab === 'admin-new-doctor' ? 'active' : ''}`} onClick={() => setActiveTab('admin-new-doctor')}>
                    <Plus size={18} />
                    <span>Add Provider</span>
                  </div>
                </>
              )}
            </div>

            <div className="user-profile-section">
              <div className="user-info">
                <span className="user-name">{user.name}</span>
                <span className="user-role">{user.role}</span>
              </div>
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', display: 'flex', justifyContent: 'center' }} onClick={logout}>
                <LogOut size={14} />
                <span>Log Out</span>
              </button>
            </div>
          </div>

          {/* Page main content area */}
          <div className="main-wrapper">
            
            {/* 1. Patient/Doctor Dashboard */}
            {activeTab === 'dashboard' && user.role !== 'admin' && (
              <div>
                <div className="page-header">
                  <h1 className="page-title">Welcome back, {user.name}</h1>
                </div>

                <div className="dashboard-grid">
                  {/* Status Summary Widget */}
                  <div className="glass-panel" style={{ padding: '24px' }}>
                    <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Activity size={18} color="var(--color-primary)" /> Status Overview
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div className="glass-card" style={{ padding: '16px', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Booked Slots</span>
                        <h2 style={{ fontSize: '32px', margin: '4px 0', color: 'var(--color-accent)' }}>
                          {appointments.filter(a => a.status === 'booked').length}
                        </h2>
                      </div>
                      <div className="glass-card" style={{ padding: '16px', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Consultations</span>
                        <h2 style={{ fontSize: '32px', margin: '4px 0', color: 'var(--color-success)' }}>
                          {appointments.filter(a => a.status === 'completed').length}
                        </h2>
                      </div>
                    </div>
                  </div>

                  {/* Active holds timer helper (if any hold token exists) */}
                  {holdToken && (
                    <div className="glass-panel" style={{ padding: '24px', borderLeft: '4px solid var(--color-secondary)' }}>
                      <h3 style={{ marginBottom: '10px', color: 'var(--color-secondary)' }}>Active Slot Hold</h3>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                        You have placed a temporary hold on a slot. Complete booking before timer expires.
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Clock size={16} />
                        <span style={{ fontWeight: 'bold', fontSize: '20px', color: 'white' }}>{holdTimerText}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Queue lists */}
                <div className="glass-panel">
                  <div className="card-header">
                    <h3>Recent Upcoming Consultations</h3>
                    <button className="btn btn-secondary btn-sm" onClick={fetchAppointments}>
                      <RefreshCw size={12} />
                    </button>
                  </div>
                  <div className="card-body">
                    {loadingAppts ? (
                      <div>Loading consultations list...</div>
                    ) : appointments.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                        No appointments found. Use the Search tab to book one.
                      </div>
                    ) : (
                      <div className="appt-list">
                        {appointments.slice(0, 3).map((appt) => (
                          <div key={appt.id} className="appt-item">
                            <div className="appt-meta">
                              <div>
                                <span className="appt-doctor">
                                  {user.role === 'patient' ? `Dr. ${appt.doctor_name}` : appt.patient_name}
                                </span>
                                <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                  {appt.specialisation || appt.patient_email}
                                </span>
                              </div>
                              <span className={`badge badge-${appt.status}`}>{appt.status}</span>
                            </div>

                            <div className="appt-time-info">
                              <CalendarIcon size={14} />
                              <span>{appt.appointment_date}</span>
                              <Clock size={14} style={{ marginLeft: '12px' }} />
                              <span>{appt.start_time} - {appt.end_time}</span>
                            </div>

                            {/* Symptoms and Pre-visit summary (visible to both doctor, and patient has pre-visit log) */}
                            {appt.symptoms && (
                              <div style={{ background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '6px', fontSize: '13px' }}>
                                <strong>Symptoms shared:</strong> {appt.symptoms}
                              </div>
                            )}

                            {/* Pre-visit AI analysis summary details */}
                            {appt.pre_visit_urgency && appt.pre_visit_urgency !== 'Pending' && (
                              <div style={{ borderLeft: '3px solid var(--color-accent)', paddingLeft: '12px', marginTop: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                  <span className={`badge badge-${appt.pre_visit_urgency.toLowerCase()}`}>
                                    Urgency: {appt.pre_visit_urgency}
                                  </span>
                                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>AI Pre-visit Analysis</span>
                                </div>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
                                  {appt.pre_visit_summary}
                                </p>
                              </div>
                            )}

                            {/* Post-visit AI summaries (completed appointments) */}
                            {appt.status === 'completed' && appt.post_visit_summary && (
                              <div style={{ borderLeft: '3px solid var(--color-success)', paddingLeft: '12px', marginTop: '8px', background: 'rgba(16,185,129,0.03)', padding: '12px', borderRadius: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                  <CheckCircle size={12} color="var(--color-success)" />
                                  <strong style={{ fontSize: '12px', color: 'var(--color-success)' }}>AI Patient Care Plan Summary</strong>
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
                                  {appt.post_visit_summary}
                                </div>
                              </div>
                            )}

                            {/* Actions */}
                            <div className="appt-actions">
                              {appt.status === 'booked' && (
                                <>
                                  <button className="btn btn-secondary btn-sm" onClick={() => startRescheduling(appt)}>
                                    Reschedule
                                  </button>
                                  <button className="btn btn-danger btn-sm" onClick={() => cancelAppointment(appt.id)}>
                                    Cancel Visit
                                  </button>
                                </>
                              )}

                              {user.role === 'doctor' && appt.status === 'booked' && (
                                <button className="btn btn-primary btn-sm" onClick={() => {
                                  setSelectedApptForNotes(appt);
                                  setConsultationNotes('');
                                  setPrescription('');
                                  setRemindersList([{ name: '', frequency: 'Daily' }]);
                                }}>
                                  Complete Consultation
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. Patient search doctors view */}
            {activeTab === 'doctors' && user.role === 'patient' && (
              <div>
                <div className="page-header">
                  <h1 className="page-title">Find a Provider</h1>
                </div>

                {/* Rescheduling active block warning */}
                {reschedulingAppt && (
                  <div className="glass-panel" style={{ padding: '16px', marginBottom: '24px', borderLeft: '4px solid var(--color-warning)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ color: 'var(--color-warning)' }}>Rescheduling active appointment</h4>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Select a new slot for your appointment on {reschedulingAppt.appointment_date}.
                      </p>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setReschedulingAppt(null)}>
                      Cancel Reschedule
                    </button>
                  </div>
                )}

                {/* Filter and search bar */}
                <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px' }}>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flexGrow: 1, position: 'relative' }}>
                      <Search size={18} style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-muted)' }} />
                      <input type="text" className="form-control" style={{ paddingLeft: '48px' }} placeholder="Search doctors by name..." value={doctorSearch} onChange={(e) => setDoctorSearch(e.target.value)} />
                    </div>
                    <div style={{ width: '220px' }}>
                      <select className="form-control" value={specialisationFilter} onChange={(e) => setSpecialisationFilter(e.target.value)}>
                        <option value="">All Specialisations</option>
                        {uniqueSpecialisations.map(spec => (
                          <option key={spec} value={spec}>{spec}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Directory cards */}
                {!selectedDoctor && !reschedulingAppt ? (
                  <div className="dashboard-grid">
                    {filteredDoctors.map(doc => (
                      <div key={doc.id} className="glass-panel glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="card-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                          <div>
                            <h3 style={{ fontSize: '18px' }}>{doc.name}</h3>
                            <span style={{ fontSize: '13px', color: 'var(--color-accent)', fontWeight: '600' }}>{doc.specialisation}</span>
                          </div>
                        </div>
                        <div className="card-body" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                            <p style={{ marginBottom: '6px' }}><strong>Hours:</strong> {doc.working_hours_start} - {doc.working_hours_end}</p>
                            <p><strong>Slot Duration:</strong> {doc.slot_duration} minutes</p>
                          </div>
                          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => {
                            setSelectedDoctor(doc);
                            setBookingDate('');
                            setSlots([]);
                            setSelectedSlot(null);
                          }}>
                            Book Appointment
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Slot Selector calendar view (For Booking or Rescheduling) */
                  <div className="glass-panel" style={{ padding: '32px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                      <div>
                        <h2>
                          {reschedulingAppt ? 'Reschedule Appointment' : `Schedule appointment with ${selectedDoctor?.name}`}
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                          {reschedulingAppt ? '' : `${selectedDoctor?.specialisation} | ${selectedDoctor?.working_hours_start} - ${selectedDoctor?.working_hours_end}`}
                        </p>
                      </div>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedDoctor(null); setBookingDate(''); setSlots([]); setSelectedSlot(null); }}>
                        Back to List
                      </button>
                    </div>

                    <div className="calendar-widget">
                      <div className="form-group" style={{ maxWidth: '300px' }}>
                        <label>Select Date</label>
                        <input type="date" className="form-control" value={reschedulingAppt ? reschedulingAppt.appointment_date : bookingDate} disabled={!!reschedulingAppt} onChange={(e) => handleDateChange(e.target.value)} />
                      </div>

                      {slots.length > 0 && (
                        <div>
                          <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: '500' }}>Available slots</label>
                          <div className="slots-grid">
                            {slots.map((slot, index) => (
                              <button key={index} className={`slot-btn ${slot.status} ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''}`} disabled={slot.status !== 'available'} onClick={() => handleSelectSlot(slot)}>
                                {slot.startTime}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {bookingDate && slots.length === 0 && (
                        <div style={{ color: 'var(--color-danger)', fontSize: '14px', padding: '16px 0' }}>
                          Dr. {selectedDoctor?.name} is unavailable or on leave for this date.
                        </div>
                      )}

                      {selectedSlot && (
                        <div style={{ marginTop: '24px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', padding: '24px', borderRadius: '12px' }}>
                          <h4 style={{ marginBottom: '16px' }}>Confirm Reservation details</h4>
                          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                            Selected: <strong>{bookingDate || reschedulingAppt?.appointment_date}</strong> at <strong>{selectedSlot.startTime} - {selectedSlot.endTime}</strong>
                          </p>

                          {!reschedulingAppt && (
                            <div className="form-group">
                              <label>Share symptoms or reasons for visit (AI pre-visit check)</label>
                              <textarea className="form-control" rows={3} placeholder="Describe any symptoms, duration, and severity..." value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />
                            </div>
                          )}

                          {holdToken && (
                            <p style={{ fontSize: '12px', color: 'var(--color-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Clock size={12} />
                              Temporary hold expires in: <strong>{holdTimerText}</strong>
                            </p>
                          )}

                          <button className="btn btn-primary" onClick={reschedulingAppt ? executeReschedule : bookAppointment}>
                            {reschedulingAppt ? 'Confirm Reschedule' : 'Finalise Booking'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3. General Appointments history list */}
            {activeTab === 'appointments' && (
              <div>
                <div className="page-header">
                  <h1 className="page-title">Appointment History</h1>
                </div>

                {/* Rescheduling overlay selector inline */}
                {reschedulingAppt && (
                  <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                      <h3>Select a new time for {reschedulingAppt.appointment_date}</h3>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setReschedulingAppt(null); setSelectedSlot(null); }}>
                        Cancel Reschedule
                      </button>
                    </div>

                    <div className="slots-grid">
                      {slots.map((slot, index) => (
                        <button key={index} className={`slot-btn ${slot.status} ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''}`} disabled={slot.status !== 'available'} onClick={() => handleSelectSlot(slot)}>
                          {slot.startTime}
                        </button>
                      ))}
                    </div>

                    {selectedSlot && (
                      <div style={{ marginTop: '20px' }}>
                        <button className="btn btn-primary" onClick={executeReschedule}>
                          Confirm Rescheduled Slot ({selectedSlot.startTime})
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="glass-panel">
                  <div className="card-header">
                    <h3>All Registered Appointments</h3>
                    <button className="btn btn-secondary btn-sm" onClick={fetchAppointments}>
                      <RefreshCw size={12} />
                    </button>
                  </div>
                  <div className="card-body">
                    {loadingAppts ? (
                      <div>Loading appointments...</div>
                    ) : appointments.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                        No appointment record history.
                      </div>
                    ) : (
                      <div className="appt-list">
                        {appointments.map((appt) => (
                          <div key={appt.id} className="appt-item">
                            <div className="appt-meta">
                              <div>
                                <span className="appt-doctor">
                                  {user.role === 'patient' ? `Dr. ${appt.doctor_name}` : appt.patient_name}
                                </span>
                                <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                  {appt.specialisation || appt.patient_email}
                                </span>
                              </div>
                              <span className={`badge badge-${appt.status}`}>{appt.status}</span>
                            </div>

                            <div className="appt-time-info">
                              <CalendarIcon size={14} />
                              <span>{appt.appointment_date}</span>
                              <Clock size={14} style={{ marginLeft: '12px' }} />
                              <span>{appt.start_time} - {appt.end_time}</span>
                            </div>

                            {appt.symptoms && (
                              <div style={{ background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '6px', fontSize: '13px' }}>
                                <strong>Symptoms shared:</strong> {appt.symptoms}
                              </div>
                            )}

                            {appt.pre_visit_urgency && appt.pre_visit_urgency !== 'Pending' && (
                              <div style={{ borderLeft: '3px solid var(--color-accent)', paddingLeft: '12px', marginTop: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                  <span className={`badge badge-${appt.pre_visit_urgency.toLowerCase()}`}>
                                    Urgency: {appt.pre_visit_urgency}
                                  </span>
                                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>AI Pre-visit Analysis</span>
                                </div>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
                                  {appt.pre_visit_summary}
                                </p>
                              </div>
                            )}

                            {appt.status === 'completed' && appt.post_visit_summary && (
                              <div style={{ borderLeft: '3px solid var(--color-success)', paddingLeft: '12px', marginTop: '8px', background: 'rgba(16,185,129,0.03)', padding: '12px', borderRadius: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                  <CheckCircle size={12} color="var(--color-success)" />
                                  <strong style={{ fontSize: '12px', color: 'var(--color-success)' }}>AI Patient Care Plan Summary</strong>
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
                                  {appt.post_visit_summary}
                                </div>
                              </div>
                            )}

                            <div className="appt-actions">
                              {appt.status === 'booked' && (
                                <>
                                  <button className="btn btn-secondary btn-sm" onClick={() => startRescheduling(appt)}>
                                    Reschedule
                                  </button>
                                  <button className="btn btn-danger btn-sm" onClick={() => cancelAppointment(appt.id)}>
                                    Cancel Visit
                                  </button>
                                </>
                              )}

                              {user.role === 'doctor' && appt.status === 'booked' && (
                                <button className="btn btn-primary btn-sm" onClick={() => {
                                  setSelectedApptForNotes(appt);
                                  setConsultationNotes('');
                                  setPrescription('');
                                  setRemindersList([{ name: '', frequency: 'Daily' }]);
                                }}>
                                  Complete Consultation
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 4. Admin Doctor list */}
            {activeTab === 'admin-doctors' && user.role === 'admin' && (
              <div>
                <div className="page-header">
                  <h1 className="page-title">Manage Medical Providers</h1>
                </div>

                {adminStatusMsg.text && (
                  <div style={{ 
                    backgroundColor: adminStatusMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', 
                    border: `1px solid ${adminStatusMsg.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'}`, 
                    color: adminStatusMsg.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    marginBottom: '20px', 
                    fontSize: '13px' 
                  }}>
                    {adminStatusMsg.text}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '32px' }}>
                  
                  {/* Doctor profiles list */}
                  <div className="glass-panel">
                    <div className="card-header">
                      <h3>Active Providers Directory</h3>
                    </div>
                    <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {doctors.map(doc => (
                        <div key={doc.id} className="appt-item" style={{ cursor: 'pointer', borderColor: adminSelectedDoctor?.id === doc.id ? 'var(--color-primary)' : 'var(--border-color)' }} onClick={() => { setAdminSelectedDoctor(doc); setAdminStatusMsg({ text: '', type: '' }); }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <div>
                              <h4 style={{ fontSize: '16px' }}>{doc.name}</h4>
                              <span style={{ fontSize: '12px', color: 'var(--color-accent)' }}>{doc.specialisation}</span>
                            </div>
                            <ChevronRight size={16} />
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '16px' }}>
                            <span><strong>Hours:</strong> {doc.working_hours_start} - {doc.working_hours_end}</span>
                            <span><strong>Duration:</strong> {doc.slot_duration}m</span>
                            <span><strong>Leaves booked:</strong> {doc.leave_days.length}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Doctor Profile Details and Schedule Leave configuration */}
                  <div>
                    {adminSelectedDoctor ? (
                      <div className="glass-panel" style={{ padding: '24px' }}>
                        <h3 style={{ marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                          Provider Leave Management
                        </h3>
                        <p style={{ fontSize: '13px', fontWeight: 'bold' }}>{adminSelectedDoctor.name}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                          Configure leave calendar. Placing leave dates automatically cancels existing conflicting bookings and notifies patients.
                        </p>

                        <div className="form-group">
                          <label>Configure New Leave Date</label>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <input type="date" className="form-control" value={newLeaveDate} onChange={(e) => setNewLeaveDate(e.target.value)} />
                            <button className="btn btn-primary" onClick={handleAddLeaveDate}>
                              Add Leave
                            </button>
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                            Scheduled Leave Dates
                          </label>
                          {adminSelectedDoctor.leave_days.length === 0 ? (
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              No leave dates currently scheduled.
                            </p>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {adminSelectedDoctor.leave_days.map(date => (
                                <span key={date} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}>
                                  {date}
                                  <X size={12} style={{ cursor: 'pointer', color: 'var(--color-danger)' }} onClick={() => handleRemoveLeaveDate(date)} />
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Select a provider from the directory to configure their leave schedule calendar.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 5. Admin Create Provider Form */}
            {activeTab === 'admin-new-doctor' && user.role === 'admin' && (
              <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                <div className="page-header">
                  <h1 className="page-title">Register New Provider</h1>
                </div>

                {adminStatusMsg.text && (
                  <div style={{ 
                    backgroundColor: adminStatusMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', 
                    border: `1px solid ${adminStatusMsg.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'}`, 
                    color: adminStatusMsg.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    marginBottom: '20px', 
                    fontSize: '13px' 
                  }}>
                    {adminStatusMsg.text}
                  </div>
                )}

                <div className="glass-panel" style={{ padding: '32px' }}>
                  <form onSubmit={handleAdminCreateDoctor}>
                    <div className="form-group">
                      <label>Doctor Name</label>
                      <input type="text" className="form-control" placeholder="Dr. Sarah Connor" value={newDoctorForm.name} onChange={(e) => setNewDoctorForm({...newDoctorForm, name: e.target.value})} required />
                    </div>

                    <div className="form-group">
                      <label>Email Address</label>
                      <input type="email" className="form-control" placeholder="sarah@clinic.com" value={newDoctorForm.email} onChange={(e) => setNewDoctorForm({...newDoctorForm, email: e.target.value})} required />
                    </div>

                    <div className="form-group">
                      <label>Temporal Password</label>
                      <input type="password" className="form-control" placeholder="••••••••" value={newDoctorForm.password} onChange={(e) => setNewDoctorForm({...newDoctorForm, password: e.target.value})} required />
                    </div>

                    <div className="form-group">
                      <label>Medical Specialisation</label>
                      <input type="text" className="form-control" placeholder="Neurology, Pediatrics, Cardiology..." value={newDoctorForm.specialisation} onChange={(e) => setNewDoctorForm({...newDoctorForm, specialisation: e.target.value})} required />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div className="form-group">
                        <label>Working Hours Start</label>
                        <input type="text" className="form-control" placeholder="09:00" value={newDoctorForm.working_hours_start} onChange={(e) => setNewDoctorForm({...newDoctorForm, working_hours_start: e.target.value})} required />
                      </div>
                      <div className="form-group">
                        <label>Working Hours End</label>
                        <input type="text" className="form-control" placeholder="17:00" value={newDoctorForm.working_hours_end} onChange={(e) => setNewDoctorForm({...newDoctorForm, working_hours_end: e.target.value})} required />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Slot Duration (minutes)</label>
                      <select className="form-control" value={newDoctorForm.slot_duration} onChange={(e) => setNewDoctorForm({...newDoctorForm, slot_duration: e.target.value})}>
                        <option value="15">15 minutes</option>
                        <option value="30">30 minutes</option>
                        <option value="45">45 minutes</option>
                        <option value="60">60 minutes</option>
                      </select>
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
                      Register Doctor Profile
                    </button>
                  </form>
                </div>
              </div>
            )}

          </div>

          {/* Doctor consultation completion modal drawer overlay */}
          {selectedApptForNotes && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}>
              <div className="glass-panel" style={{ width: '90%', maxWidth: '600px', padding: '32px', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
                  <h3>Consultation Notes: {selectedApptForNotes.patient_name}</h3>
                  <X size={20} style={{ cursor: 'pointer' }} onClick={() => setSelectedApptForNotes(null)} />
                </div>

                <div className="form-group">
                  <label>Clinical Notes</label>
                  <textarea className="form-control" rows={4} placeholder="Describe examination findings, diagnosis, and plan..." value={consultationNotes} onChange={(e) => setConsultationNotes(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>Prescriptions (Medications prescribed)</label>
                  <input type="text" className="form-control" placeholder="Amoxicillin 500mg, Paracetamol 1g..." value={prescription} onChange={(e) => setPrescription(e.target.value)} />
                </div>

                {/* Medication reminders register */}
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '10px', fontWeight: '500' }}>
                    Medication Reminder Schedule (Sends notifications to patient)
                  </label>
                  
                  {remindersList.map((item, index) => (
                    <div key={index} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                      <input type="text" className="form-control" placeholder="Medication Name" value={item.name} onChange={(e) => {
                        const updated = [...remindersList];
                        updated[index].name = e.target.value;
                        setRemindersList(updated);
                      }} />
                      <select className="form-control" style={{ width: '180px' }} value={item.frequency} onChange={(e) => {
                        const updated = [...remindersList];
                        updated[index].frequency = e.target.value;
                        setRemindersList(updated);
                      }}>
                        <option value="Daily">Daily</option>
                        <option value="Every 12 hours">Twice a day (12h)</option>
                        <option value="Every 8 hours">Thrice a day (8h)</option>
                        <option value="Weekly">Weekly</option>
                      </select>
                      {remindersList.length > 1 && (
                        <button className="btn btn-danger btn-sm" onClick={() => {
                          setRemindersList(remindersList.filter((_, idx) => idx !== index));
                        }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}

                  <button className="btn btn-secondary btn-sm" style={{ marginTop: '8px' }} onClick={() => setRemindersList([...remindersList, { name: '', frequency: 'Daily' }])}>
                    <Plus size={12} /> Add Medication
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button className="btn btn-secondary" onClick={() => setSelectedApptForNotes(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={submitCarePlan}>Submit & Send Care Plan</button>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Simulation Drawer toggler */}
          <button className="sim-toggle-btn" onClick={() => setIsSimOpen(!isSimOpen)}>
            <Bell size={24} />
          </button>

          {/* Simulation Dashboard Panel */}
          <div className={`sim-panel ${isSimOpen ? 'open' : ''}`}>
            <div className="sim-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Activity size={18} color="var(--color-accent)" />
                <h3 style={{ fontSize: '16px' }}>MedVibe Simulator Hub</h3>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setIsSimOpen(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="sim-tabs">
              <button className={`sim-tab-btn ${simTab === 'logs' ? 'active' : ''}`} onClick={() => setSimTab('logs')}>Server Logs</button>
              <button className={`sim-tab-btn ${simTab === 'emails' ? 'active' : ''}`} onClick={() => setSimTab('emails')}>Emails Sent</button>
              <button className={`sim-tab-btn ${simTab === 'calendar' ? 'active' : ''}`} onClick={() => setSimTab('calendar')}>Google Cal</button>
              <button className={`sim-tab-btn ${simTab === 'scheduler' ? 'active' : ''}`} onClick={() => setSimTab('scheduler')}>Scheduler</button>
            </div>

            <div className="sim-content">
              {/* Tab 1: Server logs console */}
              {simTab === 'logs' && (
                <div style={{ height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Live system execution traces</span>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '4px 8px', fontSize: '10px' }} onClick={fetchSimData}>Refresh</button>
                  </div>
                  <div className="logs-container">
                    {simLogs.map((log, index) => (
                      <div key={index} className={`log-line ${log.type}`}>
                        <span style={{ color: 'var(--text-muted)' }}>[{log.timestamp}]</span> {log.message}
                      </div>
                    ))}
                    {simLogs.length === 0 && <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No system logs yet.</div>}
                  </div>
                </div>
              )}

              {/* Tab 2: Simulated Emails list */}
              {simTab === 'emails' && (
                <div className="inbox-list">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Inbox Simulation (HTML Previews)</span>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '4px 8px', fontSize: '10px' }} onClick={fetchSimData}>Refresh</button>
                  </div>
                  {simEmails.map(email => (
                    <div key={email.id} className="email-card">
                      <div className="email-card-hdr">
                        <span><strong>To:</strong> {email.recipient_email}</span>
                        <span>{new Date(email.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="email-card-subject">{email.subject}</div>
                      <div style={{ fontSize: '10px', color: 'var(--color-success)', fontWeight: 'bold' }}>Status: {email.status}</div>
                      <div className="email-body-preview" dangerouslySetInnerHTML={{ __html: email.body }} />
                    </div>
                  ))}
                  {simEmails.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                      No emails generated yet. Try booking/cancelling appointments!
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Simulated Google Calendar events list */}
              {simTab === 'calendar' && (
                <div className="inbox-list">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Synced Google Calendar Events (JSON payloads)</span>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '4px 8px', fontSize: '10px' }} onClick={fetchSimData}>Refresh</button>
                  </div>
                  {simCalendar.map(cal => (
                    <div key={cal.id} className="email-card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
                      <div className="email-card-hdr">
                        <span><strong>Owner:</strong> {cal.recipient_email}</span>
                        <span>{new Date(cal.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="email-card-subject">{cal.subject}</div>
                      <div style={{ fontSize: '10px', color: 'var(--color-accent)', fontWeight: 'bold', marginBottom: '8px' }}>Sync status: {cal.status}</div>
                      <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', overflowX: 'auto', fontFamily: 'monospace' }}>
                        {cal.body}
                      </pre>
                    </div>
                  ))}
                  {simCalendar.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                      No Google Calendar sync events logged.
                    </div>
                  )}
                </div>
              )}

              {/* Tab 4: Background Scheduler dashboard control */}
              {simTab === 'scheduler' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div>
                      <h4 style={{ fontSize: '13px' }}>Background Scheduler state</h4>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Interval: 10s tick</p>
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={simTickRunning} onClick={triggerSimTick}>
                      {simTickRunning ? 'Processing...' : 'Run Tick Now'}
                      <Play size={12} />
                    </button>
                  </div>

                  {/* Active slot holds */}
                  <div className="scheduler-sect">
                    <h4>Active Reservation Holds</h4>
                    {simScheduler.activeHolds.length === 0 ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No active holds on slots.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {simScheduler.activeHolds.map(hold => (
                          <div key={hold.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '6px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Doctor ID {hold.doctor_id} | {hold.appointment_date} {hold.start_time}</span>
                            <span style={{ color: 'var(--color-warning)' }}>
                              Expires in: {Math.max(0, Math.round((hold.expires_at - Date.now()) / 1000))}s
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Registered Medication schedules list */}
                  <div className="scheduler-sect">
                    <h4>Registered Medication schedules</h4>
                    {simScheduler.reminders.length === 0 ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No active medication reminders.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {simScheduler.reminders.map(rem => (
                          <div key={rem.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '6px', fontSize: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <strong>{rem.patient_name}</strong>
                              <span className="badge badge-booked">{rem.status}</span>
                            </div>
                            <p style={{ color: 'var(--text-secondary)' }}>Med: {rem.medication_name} ({rem.frequency})</p>
                            <p style={{ color: 'var(--color-accent)', fontSize: '11px', marginTop: '4px' }}>
                              Next Alert in: {Math.max(0, Math.round((rem.next_send - Date.now()) / 1000))}s
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
