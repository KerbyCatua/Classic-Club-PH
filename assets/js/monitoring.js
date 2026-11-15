(function () {
  'use strict';
  window.initLiveMonitoring = function (helpers) {
    const { byId, escapeHtml: esc, getCsrfToken } = helpers;
    const section = byId('module-monitoring');
    if (!section || section.dataset.initialized) return;
    section.dataset.initialized = 'true';
    let busy = false;
    let current = null;
    let receivedAt = 0;
    let canExport = false;
    const labels = { application: 'Application', api: 'Catalog API', database: 'Database', server: 'PHP runtime' };
    const selectedQuery = () => new URLSearchParams({ range: byId('monitorRange').value, service: byId('monitorService').value }).toString();
    const dataQuery = data => new URLSearchParams({ range: data.range, service: data.service }).toString();
    const text = (id, value) => { byId(id).textContent = value; };
    const number = (value, digits = 2) => value == null ? 'No samples' : Number(value).toLocaleString('en-PH', { maximumFractionDigits: digits });
    const timestamp = value => value ? Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + '+08:00') : NaN;
    const date = value => Number.isFinite(timestamp(value)) ? new Date(timestamp(value)).toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium'
    }) + ' PHT' : 'No samples';

    function chart(id, rows, field, unit, title) {
      const container = byId(id);
      const measured = rows.filter(row => row[field] != null && Number.isFinite(Number(row[field])));
      if (!measured.length) {
        container.innerHTML = '<p class="text-muted-cc monitor-note mb-0">No measured samples in this range.</p>';
        container.setAttribute('aria-label', title + ': no measured samples.');
        return;
      }
      const peak = Math.max(...measured.map(row => Number(row[field])), 0.001);
      const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
      const max = Math.ceil(peak / magnitude / 2) * magnitude * 2;
      const tickCount = Math.min(5, Math.max(2, Math.floor((container.clientWidth - 48) / 64)));
      const ticks = new Set(Array.from({ length: tickCount }, (_, index) => Math.round(index * (rows.length - 1) / (tickCount - 1))));
      container.style.setProperty('--monitor-chart-gap', Math.min(6, Math.max(1, (container.clientWidth - 48) / rows.length / 4)) + 'px');
      container.setAttribute('aria-label', title + ', ' + unit + '. Focus a bar for its measurement. Gaps have no samples.');
      container.innerHTML = '<div class="sa-chart"><div class="sa-chart-y" aria-hidden="true">' +
        [1, .5, 0].map(ratio => '<span>' + number(max * ratio, 3) + '</span>').join('') +
        '</div><div class="sa-chart-main"><div class="sa-chart-plot">' + rows.map(row => {
          const value = row[field];
          const missing = value == null || !Number.isFinite(Number(value));
          const description = row.label + ': ' + (missing ? 'No samples' : number(value, 3) + ' ' + unit);
          return '<div class="monitor-chart-point" tabindex="0" role="img" aria-label="' + esc(description) + '">' +
            '<div class="sa-chart-bar' + (missing ? ' monitor-chart-gap' : '') + '" style="height:' + (missing ? 0 : Math.max(0, Number(value)) / max * 100) + '%"></div>' +
            '<span class="monitor-chart-tooltip" aria-hidden="true">' + esc(description) + '</span></div>';
        }).join('') + '</div><div class="sa-chart-labels" aria-hidden="true">' + rows.map((row, index) => {
          const show = ticks.has(index);
          const label = current.range === '24h' ? row.label.slice(-5) : row.label;
          return '<div>' + (show ? '<span>' + esc(label) + '</span>' : '') + '</div>';
        }).join('') + '</div></div></div>';
    }

    function serviceState(row) {
      // Age checks against the server's clock, including time since the last successful response.
      const now = timestamp(current.generated_at) + Math.max(0, Date.now() - receivedAt);
      const age = now - timestamp(row.checked_at);
      const fresh = Number.isFinite(age) && age >= 0 && age < 180000;
      return {
        variant: !fresh || row.status === 'Maintenance' ? 'warning' : Number(row.healthy) === 1 ? 'success' : 'danger',
        status: fresh ? row.status : 'Stale / ' + row.status
      };
    }

    function updateFreshness() {
      if (!current) return;
      section.querySelectorAll('#monitorServices tr[data-service]').forEach(element => {
        const row = current.services.find(sample => sample.service === element.dataset.service);
        const state = serviceState(row);
        const badge = element.querySelector('.sa-badge');
        badge.className = 'sa-badge sa-badge-' + state.variant;
        badge.textContent = state.status;
      });
    }

    function renderServices() {
      if (!current) return;
      const expanded = new Set(Array.from(section.querySelectorAll('#monitorServices tr[data-service]:has(details[open])'), row => row.dataset.service));
      const services = current.service === 'all' ? Object.keys(labels) : [current.service];
      byId('monitorServices').innerHTML = services.map(service => {
        const row = current.services.find(sample => sample.service === service);
        if (!row) return '<tr><td>' + esc(labels[service]) + '</td><td><span class="sa-badge sa-badge-neutral">No samples</span></td><td colspan="2">No stored checks in this range.</td></tr>';
        const { variant, status } = serviceState(row);
        const details = esc(row.context || 'No diagnostic detail.');
        const resource = row.resource_value == null ? '' : '<div>' + esc(row.resource_label + ': ' + number(row.resource_value, 3)) + '</div>';
        return '<tr data-service="' + service + '"><td><strong>' + esc(labels[service]) + '</strong><details class="monitor-service-detail"' + (expanded.has(service) ? ' open' : '') + '><summary>Details</summary><div>' + details + '</div>' + resource + '</details></td>' +
          '<td><span class="sa-badge sa-badge-' + variant + '">' + esc(status) + '</span></td>' +
          '<td>' + (service === 'server' ? row.resource_value == null ? 'Not measured' : esc(number(row.resource_value, 3) + ' MiB peak') : row.latency_ms == null ? 'Not measured' : esc(number(row.latency_ms, 3) + ' ms')) + '</td>' +
          '<td>' + esc(date(row.checked_at)) + '</td></tr>';
      }).join('');
    }

    function syncVisibility() {
      const service = byId('monitorService').value;
      const runtime = service === 'server';
      const api = ['all', 'api'].includes(service);
      const memory = ['all', 'server'].includes(service);
      ['monitorAvailabilityCard', 'monitorFailuresCard', 'monitorFailurePanel', 'monitorIncidentPanel'].forEach(id => { byId(id).hidden = runtime; });
      byId('monitorLatencyCard').hidden = !api;
      byId('monitorApiPanel').hidden = !api;
      byId('monitorResourcePanel').hidden = !memory;
      byId('monitorHistory').hidden = !api && !memory;
      byId('monitorChartHelp').hidden = !api && !memory;
    }

    function render(data) {
      current = data;
      receivedAt = Date.now();
      syncVisibility();
      text('monitorSnapshot', data.last_sample ? 'Latest check: ' + date(data.last_sample) : 'No stored checks in this range.');
      text('monitorAvailability', number(data.availability_percent) + (data.availability_percent == null ? '' : '%'));
      text('monitorCoverage', number(data.check_count) + ' observed checks');
      text('monitorLatency', number(data.api_p95_ms) + (data.api_p95_ms == null ? '' : ' ms'));
      text('monitorMedian', 'Median: ' + number(data.api_median_ms) + (data.api_median_ms == null ? '' : ' ms'));
      text('monitorFailures', data.checks_24h ? number(data.failed_24h) : 'No samples');
      text('monitorFailureRate', data.checks_24h ? number(data.failed_24h / data.checks_24h * 100) + '% of ' + number(data.checks_24h) + ' checks' : 'No checks in the last 24 hours');
      const state = data.maintenance;
      text('monitorMaintenanceValue', state.active ? 'Active' : 'Off');
      const next = state.window.status === 'Scheduled' && timestamp(state.window.start_at) > timestamp(state.server_time);
      text('monitorMaintenanceSub', state.active ? (state.manual_mode ? 'Manual maintenance' : 'Scheduled maintenance') : next ? 'Next: ' + date(state.window.start_at) : 'No scheduled maintenance');
      renderServices();
      renderCharts();
      byId('monitorFailureHistory').innerHTML = data.history.some(row => row.checks) ? data.history.slice().reverse().map(row =>
        '<tr><td>' + esc(row.label) + '</td><td>' + (row.checks ? esc(number(row.failed) + ' / ' + number(row.checks)) : 'No samples') + '</td><td>' +
        (row.checks ? number(row.failed / row.checks * 100) + '%' : '—') + '</td></tr>'
      ).join('') : '<tr><td colspan="3">No measured checks in this range.</td></tr>';
      byId('monitorIncidents').innerHTML = data.incidents.length ? data.incidents.map(row =>
        '<div class="sa-list-row"><div class="sa-list-title">' + esc((labels[row.service] || row.service) + ' / ' + row.status) +
        '</div><div class="sa-list-meta">' + esc(date(row.checked_at)) + '</div><div class="sa-list-meta">' + esc(row.context) + '</div></div>'
      ).join('') : '<p class="text-muted-cc monitor-note mb-0">No failed checks recorded in this range.</p>';
      byId('monitorEvents').innerHTML = data.events.length ? data.events.map(row =>
        '<div class="sa-list-row"><div class="sa-list-title">' + esc(row.action) + '</div><div class="sa-list-meta">' + esc(date(row.created_at)) + '</div></div>'
      ).join('') : '<p class="text-muted-cc monitor-note mb-0">No maintenance or failure audit events in this range.</p>';
    }

    function renderCharts() {
      if (!current) return;
      chart('monitorApiChart', current.history, 'p95_ms', 'ms', 'Catalog API p95');
      chart('monitorResourceChart', current.history, 'memory_mib', 'MiB', 'Mean PHP request peak memory');
    }

    function clearDisplay(message) {
      current = null;
      text('monitorSnapshot', message);
      ['monitorAvailability', 'monitorLatency', 'monitorFailures', 'monitorMaintenanceValue'].forEach(id => text(id, '—'));
      ['monitorCoverage', 'monitorMedian', 'monitorFailureRate', 'monitorMaintenanceSub'].forEach(id => text(id, 'Data unavailable'));
      byId('monitorServices').innerHTML = '<tr><td colspan="4">No health checks loaded. Use Refresh checks to retry.</td></tr>';
      byId('monitorFailureHistory').innerHTML = '<tr><td colspan="3">No history loaded.</td></tr>';
      ['monitorApiChart', 'monitorResourceChart', 'monitorIncidents', 'monitorEvents'].forEach(id => {
        text(id, 'Data unavailable for the selected filters.');
        if (byId(id).hasAttribute('aria-label')) byId(id).setAttribute('aria-label', 'Data unavailable for the selected filters.');
      });
    }

    async function load(collect) {
      if (busy) return;
      busy = true;
      canExport = false;
      const query = selectedQuery();
      const controller = new AbortController();
      let timeout;
      byId('btnRefreshMonitoring').disabled = true;
      byId('btnExportMonitoring').disabled = true;
      section.setAttribute('aria-busy', 'true');
      byId('monitorStatus').classList.remove('text-warning');
      text('monitorStatus', collect ? 'Checking services…' : 'Loading history…');
      if (current && dataQuery(current) !== query) clearDisplay('Loading the selected service and range…');
      try {
        const request = async () => {
          const headers = { Accept: 'application/json' };
          if (collect) headers['X-CSRF-Token'] = await getCsrfToken();
          const response = await fetch('public/api/super-admin/monitoring.php?' + query, {
            method: collect ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers, signal: controller.signal
          });
          let payload;
          try { payload = await response.json(); } catch { throw new Error('The monitoring server returned an invalid response.'); }
          if (!response.ok || !payload || !payload.success) throw new Error(payload && payload.error && payload.error.message || 'Unable to load monitoring.');
          if (!payload.data || dataQuery(payload.data) !== query) throw new Error('The monitoring response did not match the selected filters.');
          const data = payload.data;
          if (!['services', 'history', 'incidents', 'events'].every(key => Array.isArray(data[key])) ||
              !data.maintenance || !data.maintenance.window || !Number.isFinite(timestamp(data.generated_at))) {
            throw new Error('The monitoring server returned incomplete data.');
          }
          return payload.data;
        };
        const data = await Promise.race([request(), new Promise((resolve, reject) => {
          timeout = setTimeout(() => { reject(new Error('The monitoring request timed out.')); controller.abort(); }, 20000);
        })]);
        if (query !== selectedQuery()) return;
        render(data);
        canExport = true;
        byId('btnExportMonitoring').disabled = false;
        text('monitorStatus', 'Updated ' + date(data.generated_at));
      } catch (error) {
        if (query !== selectedQuery()) return;
        if (!current) clearDisplay('Health checks could not be loaded.');
        updateFreshness();
        text('monitorStatus', (current ? 'Displayed data is stale. ' : '') + error.message + ' Use Refresh checks to retry.');
        byId('monitorStatus').classList.add('text-warning');
      } finally {
        clearTimeout(timeout);
        busy = false;
        byId('btnRefreshMonitoring').disabled = false;
        section.setAttribute('aria-busy', 'false');
        if (query !== selectedQuery()) load(false);
      }
    }

    byId('btnRefreshMonitoring').addEventListener('click', () => load(true));
    ['monitorRange', 'monitorService'].forEach(id => byId(id).addEventListener('change', () => {
      canExport = false;
      byId('btnExportMonitoring').disabled = true;
      syncVisibility();
      if (current && dataQuery(current) !== selectedQuery()) clearDisplay('Loading the selected service and range…');
      load(false);
    }));
    byId('btnExportMonitoring').addEventListener('click', () => {
      if (!canExport || !current || busy || selectedQuery() !== dataQuery(current)) return;
      const rows = [['Period start (PHT)', 'Checks', 'Failures', 'API p95 (ms)', 'PHP request peak memory mean (MiB)'],
        ...current.history.map(row => [row.period || row.label, row.checks, row.failed, row.p95_ms ?? '', row.memory_mib ?? ''])];
      const cell = value => '"' + String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
      const csv = rows.map(row => row.map(cell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'monitoring-' + current.range + '-' + current.service + '.csv';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    load(true);
    let chartWidth = 0;
    new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (width !== chartWidth) { chartWidth = width; renderCharts(); }
    }).observe(section);
    setInterval(() => { if (!document.hidden) load(true); }, 60000);
    setInterval(() => { if (!document.hidden) updateFreshness(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
  };
})();
