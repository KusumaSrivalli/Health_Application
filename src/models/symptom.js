/**
 * Data model and input validation for patient symptom logs.
 */

export const MIN_SEVERITY = 1;
export const MAX_SEVERITY = 10;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_PATIENT_ID_LENGTH = 64;

const PATIENT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_CLOCK_SKEW_MS = 60_000;

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

  // 3. Validate severity (strict integer 1-10, no string coercion)
  const rawSeverity = payload.severity;
  if (
    typeof rawSeverity !== 'number' ||
    !Number.isInteger(rawSeverity) ||
    rawSeverity < MIN_SEVERITY ||
    rawSeverity > MAX_SEVERITY
  ) {
    errors.push({
      field: 'severity',
      message: `Severity must be an integer between ${MIN_SEVERITY} and ${MAX_SEVERITY}.`
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
  } else if (typeof payload.timestamp !== 'string' || !ISO_8601_PATTERN.test(payload.timestamp.trim())) {
    errors.push({
      field: 'timestamp',
      message: 'Timestamp must be a valid ISO-8601 date-time string (e.g. 2026-11-26T09:00:00Z).'
    });
  } else {
    const parsedTime = Date.parse(payload.timestamp.trim());
    if (Number.isNaN(parsedTime)) {
      errors.push({
        field: 'timestamp',
        message: 'Timestamp must be a valid ISO-8601 date-time string.'
      });
    } else if (parsedTime > Date.now() + MAX_CLOCK_SKEW_MS) {
      errors.push({
        field: 'timestamp',
        message: 'Timestamp cannot be in the future.'
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
      severity: rawSeverity,
      timestamp: normalizedTimestamp
    }
  };
}
