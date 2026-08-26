import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
let ai: any = null;

if (apiKey) {
  try {
    ai = new GoogleGenerativeAI(apiKey);
  } catch (e: any) {
    console.error('Failed to initialize GoogleGenerativeAI with key:', e.message);
  }
}

interface PreVisitOutput {
  urgency: 'Low' | 'Medium' | 'High' | 'Pending';
  chiefComplaint: string;
  suggestedQuestions: string[];
}

// Generate deterministic/intelligent mock pre-visit summary based on symptoms
function generateMockPreVisit(symptoms: string): PreVisitOutput {
  const s = symptoms.toLowerCase();
  let urgency: 'Low' | 'Medium' | 'High' | 'Pending' = 'Low';
  let chiefComplaint = 'General Checkup / Consultation';
  let questions = [
    'How long have you been experiencing these symptoms?',
    'Does anything specific make the symptoms better or worse?',
    'Are you taking any over-the-counter medications for relief?'
  ];

  if (s.includes('chest pain') || s.includes('breathing') || s.includes('shortness of breath') || s.includes('heart') || s.includes('severe bleeding')) {
    urgency = 'High';
    chiefComplaint = s.includes('chest') ? 'Cardiovascular symptoms/chest pain' : 'Respiratory difficulty';
    questions = [
      'Do you feel pressure radiating to your arm, neck, or jaw?',
      'Is the shortness of breath worse when lying down flat?',
      'Have you ever had a similar episode or history of cardiovascular conditions?'
    ];
  } else if (s.includes('fever') || s.includes('cough') || s.includes('throat') || s.includes('flu') || s.includes('cold') || s.includes('infection')) {
    urgency = 'Medium';
    chiefComplaint = 'Upper respiratory infection/flu-like symptoms';
    questions = [
      'Have you measured your body temperature, and what was the highest reading?',
      'Are you experiencing body aches, chills, or fatigue?',
      'Is the cough productive of phlegm, or is it dry?'
    ];
  } else if (s.includes('skin') || s.includes('rash') || s.includes('itch') || s.includes('allergy') || s.includes('spot')) {
    urgency = 'Low';
    chiefComplaint = 'Dermatological symptoms/allergy flare-up';
    questions = [
      'Have you started using any new soaps, lotions, or laundry detergents?',
      'Is the rash itchy or painful, and has it spread to other parts of the body?',
      'Are there other symptoms like hives, fever, or swelling of the face/lips?'
    ];
  } else if (s.includes('stomach') || s.includes('pain') || s.includes('abdominal') || s.includes('vomit') || s.includes('nausea')) {
    urgency = 'Medium';
    chiefComplaint = 'Gastrointestinal distress/abdominal discomfort';
    questions = [
      'Where exactly is the pain located in your abdomen?',
      'Have you been able to keep fluids down, and for how long?',
      'Does the pain worsen after eating or during specific movements?'
    ];
  } else if (s.includes('head') || s.includes('headache') || s.includes('migraine') || s.includes('dizzy')) {
    urgency = 'Medium';
    chiefComplaint = 'Neurological symptoms/headache';
    questions = [
      'Is the pain throbbing, sharp, or dull, and is it on one or both sides?',
      'Are you experiencing sensitivity to light or sound?',
      'Do you have any vision changes, numbness, or tingling?'
    ];
  }

  return {
    urgency,
    chiefComplaint,
    suggestedQuestions: questions
  };
}

// Generate smart mock post-visit summary based on notes & prescription
function generateMockPostVisit(notes: string, prescription: string): string {
  const notesText = notes || 'No detailed clinical notes provided.';
  const rxText = prescription || 'None';

  return `### Patient-Friendly Summary
Based on your consultation today, here is a simplified summary of your diagnosis and follow-up plan:

**Clinical Evaluation Summary:**
${notesText}

**Medication Schedule:**
*Prescribed Treatment:* ${rxText}
Please ensure you take the medications exactly as detailed by your doctor. Follow the frequency guidelines (e.g., daily, twice a day) and finish the entire course unless advised otherwise.

**Follow-up Steps & Recommendations:**
1. Rest and allow your body to recover.
2. Maintain adequate hydration by drinking plenty of water.
3. Monitor your symptoms closely. If you develop any worsening symptoms, contact the clinic immediately or seek emergency medical attention.
4. Schedule a follow-up appointment in 1-2 weeks if symptoms do not improve.`;
}

/**
 * Analyzes patient symptoms and returns pre-visit summary
 * Expected return format: { urgency: 'Low'|'Medium'|'High', chiefComplaint: string, suggestedQuestions: string[] }
 */
export async function getPreVisitSummary(symptoms: string): Promise<PreVisitOutput> {
  if (!symptoms || symptoms.trim() === '') {
    return generateMockPreVisit('');
  }

  if (!ai) {
    console.log('Gemini API key not configured, returning mock pre-visit summary.');
    return generateMockPreVisit(symptoms);
  }

  try {
    const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor.
    You MUST respond with a valid JSON object EXACTLY in this format, with no markdown formatting tags and no extra text around:
    {
      "urgency": "Low" or "Medium" or "High",
      "chiefComplaint": "Brief explanation of the main symptom issues",
      "suggestedQuestions": ["Question 1", "Question 2", "Question 3"]
    }
    Symptoms: ${symptoms}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    // Clean up potential markdown formatting block if returned
    let cleanText = responseText;
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    return JSON.parse(cleanText) as PreVisitOutput;
  } catch (err: any) {
    console.error('LLM Pre-visit request failed, falling back to mock summary. Error:', err.message);
    return generateMockPreVisit(symptoms);
  }
}

/**
 * Converts clinical notes and prescription to patient-friendly summary
 */
export async function getPostVisitSummary(notes: string, prescription: string): Promise<string> {
  if (!ai) {
    console.log('Gemini API key not configured, returning mock post-visit summary.');
    return generateMockPostVisit(notes, prescription);
  }

  try {
    const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps:
    Clinical Notes: ${notes}
    Prescription details: ${prescription}
    Please write this in a warm, patient-friendly tone using clear markdown headings and bullet points.`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err: any) {
    console.error('LLM Post-visit request failed, falling back to mock summary. Error:', err.message);
    return generateMockPostVisit(notes, prescription);
  }
}
