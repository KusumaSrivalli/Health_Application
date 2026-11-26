import { formatShortDate, getSeverityInfo } from '/utils.js';

/**
 * Renders the 30-day daily average symptom severity SVG line chart.
 */
export function renderChart({
  chartContainer,
  chartTooltip,
  activePatientId,
  summary,
  maxSeverity
}) {
  chartContainer.innerHTML = '';
  chartTooltip.classList.add('hidden');

  if (!activePatientId) {
    chartContainer.innerHTML = '<div class="empty-state">Enter or select a Patient ID to view severity trends.</div>';
    return;
  }

  if (!summary || summary.totalCount === 0) {
    chartContainer.innerHTML = '<div class="empty-state">No data points yet for this patient.</div>';
    return;
  }

  const dailyPoints = summary.dailyAverages30d || [];
  if (dailyPoints.length === 0) {
    chartContainer.innerHTML = '<div class="empty-state">No symptom logs recorded in the last 30 days.</div>';
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
  svg.setAttribute('aria-label', `30-day average symptom severity trend chart for ${activePatientId}`);

  const yForSeverity = (sev) => pad.top + ((10 - sev) / 9) * plotH;
  const xForIndex = (idx) => {
    if (dailyPoints.length === 1) return pad.left + plotW / 2;
    return pad.left + (idx / (dailyPoints.length - 1)) * plotW;
  };

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
      chartTooltip.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'tooltip-title';
      header.textContent = `Avg Severity ${pt.item.severity}/${maxSeverity} (${info.label})`;

      const time = document.createElement('div');
      time.className = 'tooltip-time';
      time.textContent = `${pt.item.dayKey} · ${pt.item.count} ${pt.item.count === 1 ? 'entry' : 'entries'}`;

      chartTooltip.append(header, time);
      chartTooltip.classList.remove('hidden');

      const leftPct = (pt.x / width) * 100;
      const topPct = (pt.y / height) * 100;
      chartTooltip.style.left = `clamp(12px, ${leftPct}%, calc(100% - 250px))`;
      chartTooltip.style.top = `${Math.max(8, topPct - 18)}%`;
    };

    const hideTip = () => chartTooltip.classList.add('hidden');

    circle.addEventListener('mouseenter', showTip);
    circle.addEventListener('focus', showTip);
    circle.addEventListener('mouseleave', hideTip);
    circle.addEventListener('blur', hideTip);
    svg.appendChild(circle);
  });

  chartContainer.appendChild(svg);
}
