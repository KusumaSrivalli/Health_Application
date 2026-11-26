import { apiFetch, setConnectionStatus } from '/api.js';
import { renderChart } from '/chart.js';
import { renderMetrics, renderPatientsList, renderTable } from '/table.js';
import { getSeverityInfo, toLocalDateTimeInputValue } from '/utils.js';

/**
 * HealthTrack Frontend Orchestrator
 * Coordinates state, form submission, error banners, and modular view rendering.
 */

const state = {
  activePatientId: '',
  sort: 'asc',
  logs: [],
  summary: null,
  patients: [],
  lastFailedAction: null,
  activeLoadController: null,
  config: {
    minSeverity: 1,
    maxSeverity: 10,
    maxDescriptionLength: 500
  }
};

const elements = {
  connectionStatus: document.getElementById('connection-status'),
  feedbackBanner: document.getElementById('feedback-banner'),
  bannerTitle: document.getElementById('banner-title'),
  bannerMessage: document.getElementById('banner-message'),
  bannerRetryBtn: document.getElementById('banner-retry-btn'),
  bannerDismissBtn: document.getElementById('banner-dismiss-btn'),

  form: document.getElementById('symptom-form'),
  patientIdInput: document.getElementById('patient-id-input'),
  descriptionInput: document.getElementById('symptom-description-input'),
  charCounter: document.getElementById('char-counter'),
  severityInput: document.getElementById('severity-input'),
  severityPreview: document.getElementById('severity-preview'),
  timestampInput: document.getElementById('timestamp-input'),
  useNowBtn: document.getElementById('use-now-btn'),
  submitBtn: document.getElementById('submit-btn'),

  patientIdError: document.getElementById('patientId-error'),
  descriptionError: document.getElementById('symptomDescription-error'),
  severityError: document.getElementById('severity-error'),
  timestampError: document.getElementById('timestamp-error'),
  formFeedback: document.getElementById('form-feedback'),

  viewPatientInput: document.getElementById('view-patient-input'),
  loadPatientBtn: document.getElementById('load-patient-btn'),
  sortSelect: document.getElementById('sort-select'),
  knownPatientsList: document.getElementById('known-patients-list'),
  quickPatients: document.getElementById('quick-patients'),
  quickPatientsChips: document.getElementById('quick-patients-chips'),

  metricCount: document.getElementById('metric-count'),
  metricAvg: document.getElementById('metric-avg'),
  metricPeak: document.getElementById('metric-peak'),
  metricTrend: document.getElementById('metric-trend'),

  chartContainer: document.getElementById('chart-container'),
  chartTooltip: document.getElementById('chart-tooltip'),
  activePatientSubtitle: document.getElementById('active-patient-subtitle'),
  symptomsTbody: document.getElementById('symptoms-tbody'),
  tablePagination: document.getElementById('table-pagination'),
  loadMoreBtn: document.getElementById('load-more-btn')
};

const request = (url, options = {}) =>
  apiFetch(url, options, (online) => setConnectionStatus(elements.connectionStatus, online));

function showBanner(type, title, message, retryFn = null) {
  elements.feedbackBanner.className = `banner ${type}`;
  elements.bannerTitle.textContent = title;
  elements.bannerMessage.textContent = message;
  state.lastFailedAction = retryFn;
  elements.bannerRetryBtn.classList.toggle('hidden', !retryFn);
}

function hideBanner() {
  elements.feedbackBanner.className = 'banner hidden';
  state.lastFailedAction = null;
}

function showFormFeedback(type, message) {
  elements.formFeedback.className = `form-feedback ${type}`;
  elements.formFeedback.textContent = message;
}

function hideFormFeedback() {
  elements.formFeedback.className = 'form-feedback hidden';
  elements.formFeedback.textContent = '';
}

function clearFieldErrors() {
  const fields = [
    [elements.patientIdInput, elements.patientIdError],
    [elements.descriptionInput, elements.descriptionError],
    [elements.severityInput, elements.severityError],
    [elements.timestampInput, elements.timestampError]
  ];
  for (const [input, errEl] of fields) {
    input.classList.remove('invalid');
    errEl.textContent = '';
  }
}

function setFieldError(fieldName, message) {
  const map = {
    patientId: [elements.patientIdInput, elements.patientIdError],
    symptomDescription: [elements.descriptionInput, elements.descriptionError],
    severity: [elements.severityInput, elements.severityError],
    timestamp: [elements.timestampInput, elements.timestampError]
  };
  const pair = map[fieldName];
  if (pair) {
    pair[0].classList.add('invalid');
    pair[1].textContent = message;
  }
}

function renderSeverityPreview() {
  const val = Number(elements.severityInput.value);
  const info = getSeverityInfo(val);
  elements.severityPreview.className = `severity-badge ${info.className}`;
  elements.severityPreview.textContent = `${val} / ${state.config.maxSeverity} · ${info.label}`;
}

function syncPatientsView() {
  renderPatientsList({
    knownPatientsList: elements.knownPatientsList,
    quickPatients: elements.quickPatients,
    quickPatientsChips: elements.quickPatientsChips,
    patients: state.patients,
    activePatientId: state.activePatientId,
    onSelectPatient: loadPatientLogs
  });
}

async function loadConfig() {
  try {
    const cfg = await request('/api/config');
    state.config = { ...state.config, ...cfg };
    elements.descriptionInput.maxLength = state.config.maxDescriptionLength;
    elements.severityInput.min = String(state.config.minSeverity);
    elements.severityInput.max = String(state.config.maxSeverity);
    elements.charCounter.textContent = `${elements.descriptionInput.value.length} / ${state.config.maxDescriptionLength}`;
    renderSeverityPreview();
  } catch {
    // Keep sensible defaults if /api/config is unreachable
  }
}

async function checkHealth() {
  try {
    await request('/api/health');
  } catch {
    // status already updated
  }
}

async function loadPatients() {
  try {
    const data = await request('/api/patients');
    state.patients = data.patients || [];
    syncPatientsView();
    if (!state.activePatientId && state.patients.length > 0) {
      await loadPatientLogs(state.patients[0].patientId);
    }
  } catch (err) {
    showBanner('error', 'Failed to load patients:', err.message, loadPatients);
  }
}

async function loadPatientLogs(patientId) {
  const trimmed = (patientId || '').trim();
  if (!trimmed) {
    showBanner('error', 'Patient ID required:', 'Please enter a Patient ID to view symptom history.');
    return;
  }

  if (state.activeLoadController) {
    state.activeLoadController.abort('superseded');
  }
  const controller = new AbortController();
  state.activeLoadController = controller;

  state.activePatientId = trimmed;
  elements.viewPatientInput.value = trimmed;
  if (!elements.patientIdInput.value.trim()) {
    elements.patientIdInput.value = trimmed;
  }
  syncPatientsView();

  try {
    const [logsData, summaryData] = await Promise.all([
      request(
        `/api/symptoms/${encodeURIComponent(trimmed)}?sort=${encodeURIComponent(state.sort)}`,
        { signal: controller.signal }
      ),
      request(
        `/api/patients/${encodeURIComponent(trimmed)}/summary`,
        { signal: controller.signal }
      )
    ]);

    state.logs = logsData.logs || [];
    state.summary = summaryData.summary || null;

    renderMetrics({
      metricCount: elements.metricCount,
      metricAvg: elements.metricAvg,
      metricPeak: elements.metricPeak,
      metricTrend: elements.metricTrend,
      summary: state.summary,
      maxSeverity: state.config.maxSeverity
    });
    renderChart({
      chartContainer: elements.chartContainer,
      chartTooltip: elements.chartTooltip,
      activePatientId: state.activePatientId,
      summary: state.summary,
      maxSeverity: state.config.maxSeverity
    });
    renderTable({
      symptomsTbody: elements.symptomsTbody,
      activePatientSubtitle: elements.activePatientSubtitle,
      activePatientId: state.activePatientId,
      logs: state.logs,
      maxSeverity: state.config.maxSeverity
    });
    const hasMore = state.summary && state.logs.length < state.summary.totalCount;
    elements.tablePagination.classList.toggle('hidden', !hasMore);
  } catch (err) {
    if (err.isSuperseded) return;
    showBanner(
      'error',
      'Unable to load symptom logs:',
      err.message,
      () => loadPatientLogs(trimmed)
    );
  }
}

async function loadMoreLogs() {
  if (!state.activePatientId) return;
  elements.loadMoreBtn.disabled = true;
  elements.loadMoreBtn.textContent = 'Loading...';
  try {
    const data = await request(
      `/api/symptoms/${encodeURIComponent(state.activePatientId)}?sort=${encodeURIComponent(state.sort)}&offset=${state.logs.length}`
    );
    state.logs = [...state.logs, ...(data.logs || [])];
    renderTable({
      symptomsTbody: elements.symptomsTbody,
      activePatientSubtitle: elements.activePatientSubtitle,
      activePatientId: state.activePatientId,
      logs: state.logs,
      maxSeverity: state.config.maxSeverity
    });
    const hasMore = state.summary && state.logs.length < state.summary.totalCount;
    elements.tablePagination.classList.toggle('hidden', !hasMore);
  } catch (err) {
    showBanner('error', 'Unable to load more logs:', err.message, loadMoreLogs);
  } finally {
    elements.loadMoreBtn.disabled = false;
    elements.loadMoreBtn.textContent = 'Load More Entries';
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();
  hideBanner();
  hideFormFeedback();
  clearFieldErrors();

  const patientId = elements.patientIdInput.value.trim();
  const symptomDescription = elements.descriptionInput.value.trim();
  const severity = Number(elements.severityInput.value);
  const rawTimestamp = elements.timestampInput.value;

  let hasClientError = false;
  if (!patientId) {
    setFieldError('patientId', 'Patient ID is required.');
    hasClientError = true;
  }
  if (!symptomDescription) {
    setFieldError('symptomDescription', 'Symptom description cannot be empty.');
    hasClientError = true;
  }
  if (
    !Number.isInteger(severity) ||
    severity < state.config.minSeverity ||
    severity > state.config.maxSeverity
  ) {
    setFieldError(
      'severity',
      `Severity must be a whole number from ${state.config.minSeverity} to ${state.config.maxSeverity}.`
    );
    hasClientError = true;
  }

  let parsedTimestampIso = null;
  if (rawTimestamp) {
    const parsed = new Date(rawTimestamp);
    if (Number.isNaN(parsed.getTime())) {
      setFieldError('timestamp', 'Please enter a valid date and time.');
      hasClientError = true;
    } else {
      parsedTimestampIso = parsed.toISOString();
    }
  }

  if (hasClientError) {
    const msg = 'All required symptom fields must be valid.';
    showBanner('error', 'Please fix the highlighted fields:', msg);
    showFormFeedback('error', `Please fix the highlighted fields: ${msg}`);
    return;
  }

  const payload = {
    patientId,
    symptomDescription,
    severity
  };
  if (parsedTimestampIso) {
    payload.timestamp = parsedTimestampIso;
  }

  elements.submitBtn.disabled = true;
  elements.submitBtn.textContent = 'Submitting...';

  try {
    await request('/api/symptoms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    elements.descriptionInput.value = '';
    elements.charCounter.textContent = `0 / ${state.config.maxDescriptionLength}`;
    elements.timestampInput.value = '';
    elements.severityInput.value = '5';
    renderSeverityPreview();

    const successMsg = `Saved entry for ${patientId} (Severity ${severity}/${state.config.maxSeverity}).`;
    showBanner('success', 'Symptom logged:', successMsg);
    showFormFeedback('success', `Symptom logged: ${successMsg}`);

    await Promise.all([loadPatients(), loadPatientLogs(patientId)]);
  } catch (err) {
    if (Array.isArray(err.details)) {
      for (const detail of err.details) {
        setFieldError(detail.field, detail.message);
      }
    }
    const canRetry = Boolean(err.isNetworkError || (err.status && err.status >= 500));
    const retryFn = canRetry ? () => elements.form.requestSubmit() : null;
    showBanner('error', 'Submission failed:', err.message, retryFn);
    showFormFeedback('error', `Submission failed: ${err.message}`);
  } finally {
    elements.submitBtn.disabled = false;
    elements.submitBtn.textContent = 'Log Symptom';
  }
}

elements.form.addEventListener('submit', handleFormSubmit);

elements.descriptionInput.addEventListener('input', () => {
  elements.charCounter.textContent = `${elements.descriptionInput.value.length} / ${state.config.maxDescriptionLength}`;
});

elements.severityInput.addEventListener('input', renderSeverityPreview);

elements.useNowBtn.addEventListener('click', () => {
  elements.timestampInput.value = toLocalDateTimeInputValue(new Date());
});

elements.loadPatientBtn.addEventListener('click', () => {
  hideBanner();
  loadPatientLogs(elements.viewPatientInput.value);
});

elements.viewPatientInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    hideBanner();
    loadPatientLogs(elements.viewPatientInput.value);
  }
});

elements.sortSelect.addEventListener('change', () => {
  state.sort = elements.sortSelect.value;
  if (state.activePatientId) {
    loadPatientLogs(state.activePatientId);
  }
});

elements.loadMoreBtn.addEventListener('click', loadMoreLogs);

elements.bannerDismissBtn.addEventListener('click', hideBanner);
elements.bannerRetryBtn.addEventListener('click', () => {
  const action = state.lastFailedAction;
  hideBanner();
  if (typeof action === 'function') action();
});

renderSeverityPreview();
loadConfig();
checkHealth();
loadPatients();
