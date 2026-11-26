/**
 * Data model and input validation for patient symptom logs.
 */

export const MIN_SEVERITY = 1;
export const MAX_SEVERITY = 10;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_PATIENT_ID_LENGTH = 64;

const PATIENT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates a patient ID string.
 * @param {unknown} rawPatientId
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
export function validatePatientId(rawPatientId) {
  if (typeof rawPatientId !== 'string') {
    return { valid: false, error: 'Patient ID must be a non-empty string.' };
  }

  const trimmed = rawPatientId.trim();
  if (!trimmed) {
    return { valid: false, error: 'Patient ID is required.' };
  }

  if (trimmed.length > MAX_PATIENT_ID_LENGTH) {
    return {
      valid: false,
      error: `Patient ID must be at most ${MAX_PATIENT_ID_LENGTH} characters.`
    };
  }

  if (!PATIENT_ID_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: 'Patient ID may only contain letters, numbers, dots, underscores, and hyphens.'
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validates and normalizes an incoming symptom log payload.
 * @param {unknown} payload
 * @returns {{
 *   valid: boolean,
 *   data?: { patientId: string, symptomDescription: string, severity: number, timestamp: string },
 *   errors?: Array<{ field: string, message: string }>
 * }}
 */
export function validateSymptomInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      errors: [{ field: 'body', message: 'Request body must be a JSON object.' }]
    };
  }

  const errors = [];

  // 1. Validate patientId
  const patientCheck = validatePatientId(payload.patientId);
  if (!patientCheck.valid) {
    errors.push({ field: 'patientId', message: patientCheck.error });
  }

  // 2. Validate symptomDescription
  let normalizedDescription = '';
  if (typeof payload.symptomDescription !== 'string') {
    errors.push({
      field: 'symptomDescription',
      message: 'Symptom description must be a non-empty string.'
    });
  } else {
    normalizedDescription = payload.symptomDescription.trim();
    if (!normalizedDescription) {
      errors.push({
        field: 'symptomDescription',
        message: 'Symptom description cannot be empty.'
      });
    } else if (normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
      errors.push({
        field: 'symptomDescription',
        message: `Symptom description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
      });
    }
  }

  // 3. Validate severity (integer 1-10)
  const rawSeverity = payload.severity;
  let parsedSeverity = NaN;
  if (typeof rawSeverity === 'number') {
    parsedSeverity = rawSeverity;
  } else if (typeof rawSeverity === 'string' && rawSeverity.trim() !== '') {
    parsedSeverity = Number(rawSeverity);
  }

  if (
    !Number.isInteger(parsedSeverity) ||
    parsedSeverity < MIN_SEVERITY ||
    parsedSeverity > MAX_SEVERITY
  ) {
    errors.push({
      field: 'severity',
      message: `Severity must be a whole number between ${MIN_SEVERITY} and ${MAX_SEVERITY}.`
    });
  }

  // 4. Validate timestamp (optional; defaults to current UTC ISO-8601 time)
  let normalizedTimestamp;
  if (
    payload.timestamp === undefined ||
    payload.timestamp === null ||
    (typeof payload.timestamp === 'string' && payload.timestamp.trim() === '')
  ) {
    normalizedTimestamp = new Date().toISOString();
  } else if (typeof payload.timestamp !== 'string') {
    errors.push({
      field: 'timestamp',
      message: 'Timestamp must be a valid ISO-8601 date string.'
    });
  } else {
    const parsedTime = Date.parse(payload.timestamp);
    if (Number.isNaN(parsedTime)) {
      errors.push({
        field: 'timestamp',
        message: 'Timestamp must be a valid ISO-8601 date string.'
      });
    } else {
      normalizedTimestamp = new Date(parsedTime).toISOString();
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      patientId: patientCheck.value,
      symptomDescription: normalizedDescription,
      severity: parsedSeverity,
      timestamp: normalizedTimestamp
    }
  };
}
