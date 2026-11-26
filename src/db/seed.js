import { SymptomStore } from './symptomStore.js';

const SAMPLE_LOGS = [
  {
    patientId: 'PAT-101',
    symptomDescription: 'Mild morning headache and neck stiffness',
    severity: 4,
    timestamp: '2026-11-20T08:30:00.000Z'
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Throbbing migraine with light sensitivity',
    severity: 8,
    timestamp: '2026-11-21T14:15:00.000Z'
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Fatigue and residual temple ache after medication',
    severity: 5,
    timestamp: '2026-11-22T10:00:00.000Z'
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Slight tension behind eyes in the afternoon',
    severity: 3,
    timestamp: '2026-11-24T16:45:00.000Z'
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Feeling much clearer, minor fatigue only',
    severity: 2,
    timestamp: '2026-11-26T09:00:00.000Z'
  },
  {
    patientId: 'PAT-102',
    symptomDescription: 'Dry cough and mild sore throat',
    severity: 4,
    timestamp: '2026-11-23T07:45:00.000Z'
  },
  {
    patientId: 'PAT-102',
    symptomDescription: 'Persistent cough with low-grade fever',
    severity: 7,
    timestamp: '2026-11-24T19:20:00.000Z'
  },
  {
    patientId: 'PAT-102',
    symptomDescription: 'Cough easing, throat discomfort improving',
    severity: 3,
    timestamp: '2026-11-25T11:10:00.000Z'
  }
];

function seed() {
  const store = new SymptomStore();
  try {
    const existing = store.listPatients();
    if (existing.length > 0) {
      console.log('Database already contains symptom logs. Skipping seed.');
      return;
    }

    for (const entry of SAMPLE_LOGS) {
      store.createLog(entry);
    }
    console.log(`Seeded ${SAMPLE_LOGS.length} sample symptom logs for PAT-101 and PAT-102.`);
  } finally {
    store.close();
  }
}

seed();
