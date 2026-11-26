import { formatDateTime, formatTrendDelta, getSeverityInfo } from '/utils.js';

/**
 * Renders patient chips, summary metric cards, and the symptom history table.
 */

export function renderPatientsList({
  knownPatientsList,
  quickPatients,
  quickPatientsChips,
  patients,
  activePatientId,
  onSelectPatient
}) {
  knownPatientsList.innerHTML = '';
  quickPatientsChips.innerHTML = '';

  if (patients.length === 0) {
    quickPatients.classList.add('hidden');
    return;
  }

  quickPatients.classList.remove('hidden');

  for (const p of patients) {
    const option = document.createElement('option');
    option.value = p.patientId;
    knownPatientsList.appendChild(option);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${p.patientId === activePatientId ? 'active' : ''}`;
    chip.textContent = `${p.patientId} (${p.logCount})`;
    chip.addEventListener('click', () => onSelectPatient(p.patientId));
    quickPatientsChips.appendChild(chip);
  }
}

export function renderMetrics({
  metricCount,
  metricAvg,
  metricPeak,
  metricTrend,
  summary,
  maxSeverity
}) {
  if (!summary || summary.totalCount === 0) {
    metricCount.textContent = '0';
    metricAvg.textContent = '—';
    metricPeak.textContent = '—';
    metricTrend.textContent = '—';
    return;
  }

  metricCount.textContent = String(summary.totalCount);
  metricAvg.textContent = `${summary.averageSeverity} / ${maxSeverity}`;
  metricPeak.textContent = `${summary.peakSeverity} / ${maxSeverity}`;
  metricTrend.textContent = formatTrendDelta(summary.totalCount, summary.recentDelta);
}

export function renderTable({
  symptomsTbody,
  activePatientSubtitle,
  activePatientId,
  logs,
  maxSeverity
}) {
  symptomsTbody.innerHTML = '';

  if (!activePatientId) {
    activePatientSubtitle.textContent = 'No patient selected';
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="empty-cell">Enter or select a Patient ID to view logs.</td>';
    symptomsTbody.appendChild(row);
    return;
  }

  activePatientSubtitle.textContent = `Showing ${logs.length} ${logs.length === 1 ? 'entry' : 'entries'} for ${activePatientId}`;

  if (logs.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-cell';
    cell.textContent = `No symptom logs recorded yet for ${activePatientId}.`;
    row.appendChild(cell);
    symptomsTbody.appendChild(row);
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
    badge.textContent = `${log.severity} / ${maxSeverity}`;
    sevTd.appendChild(badge);

    const levelTd = document.createElement('td');
    levelTd.textContent = info.label;

    tr.append(timeTd, descTd, sevTd, levelTd);
    symptomsTbody.appendChild(tr);
  }
}
