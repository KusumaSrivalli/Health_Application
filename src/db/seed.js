import { SymptomStore } from './symptomStore.js';

function daysAgoIso(daysAgo, hour = 9) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

const SAMPLE_LOGS = [
  {
    patientId: 'PAT-101',
    symptomDescription: 'Mild morning headache and neck stiffness',
    severity: 4,
    timestamp: daysAgoIso(10, 8)
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Throbbing migraine with light sensitivity',
    severity: 8,
    timestamp: daysAgoIso(8, 14)
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Fatigue and residual temple ache after medication',
    severity: 5,
    timestamp: daysAgoIso(6, 10)
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Slight tension behind eyes in the afternoon',
    severity: 3,
    timestamp: daysAgoIso(3, 16)
  },
  {
    patientId: 'PAT-101',
    symptomDescription: 'Feeling much clearer, minor fatigue only',
    severity: 2,
    timestamp: daysAgoIso(1, 9)
  },
  {
    patientId: 'PAT-102',
    symptomDescription: 'Dry cough and mild sore throat',
    severity: 4,
    timestamp: daysAgoIso(5, 8)
  },
  {
    patientId: 'PAT-102',
    symptomDescription: 'Persistent cough with low-grade fever',
    severity: 7,
    timestamp: daysAgoIso(3, 19)
  },
  {
    patientId: 'PAT-102',
    symptomDescription: 'Cough easing, throat discomfort improving',
    severity: 3,
    timestamp: daysAgoIso(1, 11)
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
