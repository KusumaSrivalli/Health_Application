/**
 * HealthTrack Frontend Application
 * Handles symptom submission, validation, error recovery, table rendering, and SVG trend charting.
 */

const state = {
  activePatientId: '',
  sort: 'asc',
  logs: [],
  patients: [],
  lastFailedAction: null
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
  symptomsTbody: document.getElementById('symptoms-tbody')
};

// --- Helpers ---

function getSeverityInfo(severity) {
  if (severity <= 3) return { label: 'Mild', className: 'severity-mild', color: '#15803d' };
  if (severity <= 6) return { label: 'Moderate', className: 'severity-moderate', color: '#d97706' };
  return { label: 'Severe', className: 'severity-severe', color: '#dc2626' };
}

function formatDateTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatShortDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toLocalDateTimeInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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

async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `Request failed with status ${response.status}`);
      err.status = response.status;
      err.details = data.details || [];
      throw err;
    }
    setConnectionStatus(true);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      setConnectionStatus(false);
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    if (err instanceof TypeError) {
      setConnectionStatus(false);
      throw new Error('Unable to reach the HealthTrack server. Verify the server is running.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function setConnectionStatus(online) {
  const el = elements.connectionStatus;
  el.className = `status-pill ${online ? 'status-online' : 'status-offline'}`;
  el.querySelector('.status-text').textContent = online ? 'API Connected' : 'API Unreachable';
}

// --- Rendering ---

function renderSeverityPreview() {
  const val = Number(elements.severityInput.value);
  const info = getSeverityInfo(val);
  elements.severityPreview.className = `severity-badge ${info.className}`;
  elements.severityPreview.textContent = `${val} / 10 · ${info.label}`;
}

function renderPatientsList() {
  elements.knownPatientsList.innerHTML = '';
  elements.quickPatientsChips.innerHTML = '';

  if (state.patients.length === 0) {
    elements.quickPatients.classList.add('hidden');
    return;
  }

  elements.quickPatients.classList.remove('hidden');

  for (const p of state.patients) {
    const option = document.createElement('option');
    option.value = p.patientId;
    elements.knownPatientsList.appendChild(option);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${p.patientId === state.activePatientId ? 'active' : ''}`;
    chip.textContent = `${p.patientId} (${p.logCount})`;
    chip.addEventListener('click', () => {
      loadPatientLogs(p.patientId);
    });
    elements.quickPatientsChips.appendChild(chip);
  }
}

function renderMetrics(logs) {
  elements.metricCount.textContent = String(logs.length);

  if (logs.length === 0) {
    elements.metricAvg.textContent = '—';
    elements.metricPeak.textContent = '—';
    elements.metricTrend.textContent = '—';
    return;
  }

  const chronological = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const sum = chronological.reduce((acc, item) => acc + item.severity, 0);
  const avg = (sum / chronological.length).toFixed(1);
  const peak = Math.max(...chronological.map((item) => item.severity));

  elements.metricAvg.textContent = `${avg} / 10`;
  elements.metricPeak.textContent = `${peak} / 10`;

  if (chronological.length < 2) {
    elements.metricTrend.textContent = 'Baseline';
  } else {
    const prev = chronological[chronological.length - 2].severity;
    const latest = chronological[chronological.length - 1].severity;
    const diff = latest - prev;
    if (diff < 0) elements.metricTrend.textContent = `Improving (${diff})`;
    else if (diff > 0) elements.metricTrend.textContent = `Worsening (+${diff})`;
    else elements.metricTrend.textContent = 'Stable (0)';
  }
}

function renderTable(logs) {
  elements.symptomsTbody.innerHTML = '';

  if (!state.activePatientId) {
    elements.activePatientSubtitle.textContent = 'No patient selected';
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="empty-cell">Enter or select a Patient ID to view logs.</td>';
    elements.symptomsTbody.appendChild(row);
    return;
  }

  elements.activePatientSubtitle.textContent = `Showing ${logs.length} ${logs.length === 1 ? 'entry' : 'entries'} for ${state.activePatientId}`;

  if (logs.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-cell';
    cell.textContent = `No symptom logs recorded yet for ${state.activePatientId}.`;
    row.appendChild(cell);
    elements.symptomsTbody.appendChild(row);
    return;
  }

  for (const log of logs) {
    const info = getSeverityInfo(log.severity);
    const tr = document.createElement('tr');

    const timeTd = document.createElement('td');
    timeTd.textContent = formatDateTime(log.timestamp);

    const descTd = document.createElement('td');
    descTd.textContent = log.symptomDescription;

    const sevTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `severity-badge ${info.className}`;
    badge.textContent = `${log.severity} / 10`;
    sevTd.appendChild(badge);

    const levelTd = document.createElement('td');
    levelTd.textContent = info.label;

    tr.append(timeTd, descTd, sevTd, levelTd);
    elements.symptomsTbody.appendChild(tr);
  }
}

function aggregateLast30DaysAverage(logs) {
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = logs.filter((log) => {
    const ms = Date.parse(log.timestamp);
    return !Number.isNaN(ms) && ms >= cutoffMs;
  });

  const byDay = new Map();
  for (const log of recent) {
    const d = new Date(log.timestamp);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, { dayKey, timestamp: log.timestamp, sum: 0, count: 0, descriptions: [] });
    }
    const bucket = byDay.get(dayKey);
    bucket.sum += log.severity;
    bucket.count += 1;
    bucket.descriptions.push(log.symptomDescription);
  }

  return Array.from(byDay.values())
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map((bucket) => ({
      dayKey: bucket.dayKey,
      timestamp: bucket.timestamp,
      severity: Number((bucket.sum / bucket.count).toFixed(1)),
      count: bucket.count,
      descriptions: bucket.descriptions
    }));
}

function renderChart(logs) {
  elements.chartContainer.innerHTML = '';
  elements.chartTooltip.classList.add('hidden');

  if (!state.activePatientId) {
    elements.chartContainer.innerHTML = '<div class="empty-state">Enter or select a Patient ID to view severity trends.</div>';
    return;
  }

  if (logs.length === 0) {
    elements.chartContainer.innerHTML = '<div class="empty-state">No data points yet for this patient.</div>';
    return;
  }

  const dailyPoints = aggregateLast30DaysAverage(logs);
  if (dailyPoints.length === 0) {
    elements.chartContainer.innerHTML = '<div class="empty-state">No symptom logs recorded in the last 30 days.</div>';
    return;
  }

  const width = 680;
  const height = 220;
  const pad = { top: 18, right: 24, bottom: 34, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `30-day average symptom severity trend chart for ${state.activePatientId}`);

  const yForSeverity = (sev) => pad.top + ((10 - sev) / 9) * plotH;
  const xForIndex = (idx) => {
    if (dailyPoints.length === 1) return pad.left + plotW / 2;
    return pad.left + (idx / (dailyPoints.length - 1)) * plotW;
  };

  // Horizontal gridlines for 1, 4, 7, 10
  for (const level of [1, 4, 7, 10]) {
    const y = yForSeverity(level);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(pad.left));
    line.setAttribute('x2', String(width - pad.right));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', '#e2e8f0');
    line.setAttribute('stroke-dasharray', level === 1 ? 'none' : '4 4');
    svg.appendChild(line);

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', String(pad.left - 8));
    label.setAttribute('y', String(y + 4));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', '#64748b');
    label.textContent = String(level);
    svg.appendChild(label);
  }

  // Polyline path
  const points = dailyPoints.map((item, idx) => ({
    x: xForIndex(idx),
    y: yForSeverity(item.severity),
    item
  }));

  if (points.length > 1) {
    const polyline = document.createElementNS(svgNS, 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', '#0f766e');
    polyline.setAttribute('stroke-width', '2.5');
    polyline.setAttribute('stroke-linejoin', 'round');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    svg.appendChild(polyline);
  }

  // Data points & X-axis labels
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((pt, idx) => {
    const info = getSeverityInfo(Math.round(pt.item.severity));

    if (idx % labelStep === 0 || idx === points.length - 1) {
      const xLabel = document.createElementNS(svgNS, 'text');
      xLabel.setAttribute('x', String(pt.x));
      xLabel.setAttribute('y', String(height - 10));
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.setAttribute('font-size', '11');
      xLabel.setAttribute('fill', '#64748b');
      xLabel.textContent = formatShortDate(pt.item.timestamp);
      svg.appendChild(xLabel);
    }

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(pt.x));
    circle.setAttribute('cy', String(pt.y));
    circle.setAttribute('r', '5');
    circle.setAttribute('fill', info.color);
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('class', 'chart-point');
    circle.setAttribute('tabindex', '0');

    const showTip = () => {
      const tip = elements.chartTooltip;
      tip.innerHTML = '';
      const header = document.createElement('div');
      header.style.fontWeight = '700';
      header.textContent = `Avg Severity ${pt.item.severity}/10 (${info.label})`;

      const time = document.createElement('div');
      time.style.opacity = '0.85';
      time.textContent = `${pt.item.dayKey} · ${pt.item.count} ${pt.item.count === 1 ? 'entry' : 'entries'}`;

      const desc = document.createElement('div');
      desc.style.marginTop = '4px';
      desc.textContent = pt.item.descriptions.join('; ');

      tip.append(header, time, desc);
      tip.classList.remove('hidden');

      const leftPct = (pt.x / width) * 100;
      const topPct = (pt.y / height) * 100;
      tip.style.left = `clamp(12px, ${leftPct}%, calc(100% - 250px))`;
      tip.style.top = `${Math.max(8, topPct - 18)}%`;
    };

    const hideTip = () => elements.chartTooltip.classList.add('hidden');

    circle.addEventListener('mouseenter', showTip);
    circle.addEventListener('focus', showTip);
    circle.addEventListener('mouseleave', hideTip);
    circle.addEventListener('blur', hideTip);
    svg.appendChild(circle);
  });

  elements.chartContainer.appendChild(svg);
}

// --- Data Operations ---

async function checkHealth() {
  try {
    await apiFetch('/api/health');
  } catch {
    // status already updated by apiFetch
  }
}

async function loadPatients() {
  try {
    const data = await apiFetch('/api/patients');
    state.patients = data.patients || [];
    renderPatientsList();
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

  state.activePatientId = trimmed;
  elements.viewPatientInput.value = trimmed;
  if (!elements.patientIdInput.value.trim()) {
    elements.patientIdInput.value = trimmed;
  }
  renderPatientsList();

  try {
    const data = await apiFetch(
      `/api/symptoms/${encodeURIComponent(trimmed)}?sort=${encodeURIComponent(state.sort)}`
    );
    state.logs = data.logs || [];
    renderMetrics(state.logs);
    renderChart(state.logs);
    renderTable(state.logs);
  } catch (err) {
    showBanner(
      'error',
      'Unable to load symptom logs:',
      err.message,
      () => loadPatientLogs(trimmed)
    );
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();
  hideBanner();
  clearFieldErrors();

  const patientId = elements.patientIdInput.value.trim();
  const symptomDescription = elements.descriptionInput.value.trim();
  const severity = Number(elements.severityInput.value);
  const rawTimestamp = elements.timestampInput.value;

  // Client-side pre-validation for immediate feedback
  let hasClientError = false;
  if (!patientId) {
    setFieldError('patientId', 'Patient ID is required.');
    hasClientError = true;
  }
  if (!symptomDescription) {
    setFieldError('symptomDescription', 'Symptom description cannot be empty.');
    hasClientError = true;
  }
  if (!Number.isInteger(severity) || severity < 1 || severity > 10) {
    setFieldError('severity', 'Severity must be a whole number from 1 to 10.');
    hasClientError = true;
  }

  if (hasClientError) {
    showBanner('error', 'Please fix the highlighted fields:', 'All required symptom fields must be valid.');
    return;
  }

  const payload = {
    patientId,
    symptomDescription,
    severity
  };
  if (rawTimestamp) {
    payload.timestamp = new Date(rawTimestamp).toISOString();
  }

  elements.submitBtn.disabled = true;
  elements.submitBtn.textContent = 'Submitting...';

  try {
    await apiFetch('/api/symptoms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    elements.descriptionInput.value = '';
    elements.charCounter.textContent = '0 / 500';
    elements.timestampInput.value = '';
    elements.severityInput.value = '5';
    renderSeverityPreview();

    showBanner('success', 'Symptom logged:', `Saved entry for ${patientId} (Severity ${severity}/10).`);
    await loadPatients();
    await loadPatientLogs(patientId);
  } catch (err) {
    if (Array.isArray(err.details)) {
      for (const detail of err.details) {
        setFieldError(detail.field, detail.message);
      }
    }
    showBanner(
      'error',
      'Submission failed:',
      err.message,
      null
    );
  } finally {
    elements.submitBtn.disabled = false;
    elements.submitBtn.textContent = 'Log Symptom';
  }
}

// --- Event Listeners ---

elements.form.addEventListener('submit', handleFormSubmit);

elements.descriptionInput.addEventListener('input', () => {
  elements.charCounter.textContent = `${elements.descriptionInput.value.length} / 500`;
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

elements.bannerDismissBtn.addEventListener('click', hideBanner);
elements.bannerRetryBtn.addEventListener('click', () => {
  const action = state.lastFailedAction;
  hideBanner();
  if (typeof action === 'function') action();
});

// Initialize
renderSeverityPreview();
checkHealth();
loadPatients();
