(function () {
  'use strict';
  window.initLiveMonitoring = function (helpers) {
    const { byId, escapeHtml: esc, getCsrfToken } = helpers;
    const section = byId('module-monitoring');
    if (!section) return;
    let busy = false;
    let current = null;
    const selectedQuery = () => new URLSearchParams({ range: byId('monitorRange').value, service: byId('monitorService').value }).toString();
    const label = { application: 'Application', api: 'Catalog API', database: 'Database', server: 'PHP runtime' };
    const text = (id, value) => { byId(id).textContent = value; };
    const number = value => value == null ? 'No samples' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
    const date = value => value ? new Date(value.includes('T') ? value : value.replace(' ', 'T') + '+08:00').toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }) + ' PHT' : 'No samples';
    function chart(id, rows, field, unit) {
      if (!rows.some(row => row[field] != null)) {
        byId(id).innerHTML = '<p class="text-muted-cc monitor-note mb-0">No measured samples for this service and range.</p>';
        return;
      }
      const max = Math.max(1, ...rows.map(row => Number(row[field]) || 0));
      byId(id).innerHTML = '<div class="sa-chart"><div class="sa-chart-y">' + [1, .75, .5, .25, 0].map(ratio => '<span>' + number(max * ratio) + '</span>').join('') +
        '</div><div class="sa-chart-main"><div class="sa-chart-plot">' + rows.map(row => '<div class="sa-chart-bar" style="min-height:0;max-width:none;height:' + (row[field] == null ? 0 : row[field] / max * 100) + '%" title="' + esc(row.label + ': ' + number(row[field]) + (row[field] == null ? '' : ' ' + unit)) + '"></div>').join('') +
        '</div><div class="sa-chart-labels">' + rows.map(row => '<div>' + esc(row.label) + '<b>' + esc(number(row[field])) + '</b></div>').join('') + '</div></div>';
      // Keep all 30 days readable in the existing horizontally scrolling chart.
      byId(id).firstElementChild.style.minWidth = Math.max(440, rows.length * 74) + 'px';
    }
    function render(data) {
      current = data;
      text('monitorSnapshot', 'Latest check: ' + date(data.last_sample) + '. Range: ' + byId('monitorRange').selectedOptions[0].textContent + '.');
      text('monitorAvailability', number(data.availability_percent) + (data.availability_percent == null ? '' : '%'));
      text('monitorCoverage', number(data.check_count) + ' observed checks; includes maintenance.');
      text('monitorLatency', number(data.api_p95_ms) + (data.api_p95_ms == null ? '' : ' ms'));
      text('monitorMedian', 'Median: ' + number(data.api_median_ms) + (data.api_median_ms == null ? '' : ' ms'));
      text('monitorFailures', number(data.failed_24h) + ' / ' + number(data.checks_24h));
      text('monitorFailureRate', data.checks_24h ? number(data.failed_24h / data.checks_24h * 100) + '% failed checks' : 'No checks in the last 24 hours');
      const state = data.maintenance;
      text('monitorMaintenanceValue', state.active ? 'Active' : 'Off');
      const next = state.window.status === 'Scheduled' && state.window.start_at > state.server_time;
      text('monitorMaintenanceSub', state.active ? (state.manual_mode ? 'Manual maintenance' : 'Scheduled maintenance') : next ? 'Next: ' + date(state.window.start_at) : 'No upcoming scheduled window');
      byId('monitorServices').innerHTML = data.services.length ? data.services.map(row => {
        const fresh = new Date(data.generated_at) - new Date(row.checked_at.replace(' ', 'T') + '+08:00') < 180000;
        const healthy = Number(row.healthy) === 1;
        const status = fresh ? row.status : 'Stale / ' + row.status;
        return '<tr><td><div class="monitor-cell-value">' + esc(label[row.service] || row.service) + '</div></td><td><span class="sa-badge sa-badge-' + (!fresh || row.status === 'Maintenance' ? 'warning' : healthy ? 'success' : 'danger') + '">' + esc(status) +
          '</span></td><td><div class="monitor-cell-value">' + (row.service === 'server' ? 'Request executing' : esc(number(row.latency_ms)) + ' ms') + '</div></td><td><div class="monitor-cell-value" tabindex="0">' + (row.resource_value == null ? 'Not measured' : esc(number(row.resource_value) + ' / ' + row.resource_label)) + '</div></td><td><div class="monitor-cell-value">' + esc(date(row.checked_at)) + '</div></td><td><div class="monitor-cell-value" tabindex="0">' + esc(row.context) + '</div></td></tr>';
      }).join('') : '<tr><td colspan="6">No stored checks for this service and range.</td></tr>';
      chart('monitorApiChart', data.history, 'p95_ms', 'ms');
      chart('monitorResourceChart', data.history, 'memory_mib', 'MiB');
      byId('monitorFailureHistory').innerHTML = data.history.length ? data.history.slice().reverse().map(row => '<tr><td><div class="monitor-cell-value">' + esc(row.label) + '</div></td><td><div class="monitor-cell-value">' + esc(row.failed + ' / ' + row.checks) + '</div></td><td><div class="monitor-cell-value">' + (row.checks ? number(row.failed / row.checks * 100) + '%' : 'No samples') + '</div></td></tr>').join('') : '<tr><td colspan="3">No history for this service and range.</td></tr>';
      byId('monitorIncidents').innerHTML = data.incidents.length ? data.incidents.map(row => '<div class="sa-list-row" tabindex="0"><div class="sa-list-title">' + esc((label[row.service] || row.service) + ' / ' + row.status) + '</div><div class="sa-list-meta">' + esc(date(row.checked_at) + ' / ' + row.context) + '</div></div>').join('') : '<p class="text-muted-cc">No failed checks recorded in this range.</p>';
      byId('monitorEvents').innerHTML = data.events.length ? data.events.map(row => '<div class="sa-list-row" tabindex="0"><div class="sa-list-title">' + esc(row.action) + '</div><div class="sa-list-meta">' + esc(date(row.created_at)) + '</div></div>').join('') : '<p class="text-muted-cc">No maintenance or failure audit events in this range.</p>';
      byId('btnExportMonitoring').disabled = false;
    }
    async function load(collect) {
      if (busy) return;
      busy = true;
      const query = selectedQuery();
      byId('btnRefreshMonitoring').disabled = true;
      byId('btnExportMonitoring').disabled = true;
      section.setAttribute('aria-busy', 'true');
      byId('monitorStatus').classList.remove('text-warning');
      text('monitorStatus', collect ? 'Checking services…' : 'Loading history…');
      try {
        const headers = { Accept: 'application/json' };
        if (collect) headers['X-CSRF-Token'] = await getCsrfToken();
        const response = await fetch('public/api/super-admin/monitoring.php?' + query, { method: collect ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error && payload.error.message || 'Unable to load monitoring.');
        // A filter can change while a request is pending; never display or export its old result.
        if (query !== selectedQuery()) return;
        render(payload.data);
        byId('monitorStatus').classList.remove('text-warning');
        text('monitorStatus', 'Updated ' + date(payload.data.generated_at) + '.');
      } catch (error) {
        if (query !== selectedQuery()) return;
        if (!current) {
          text('monitorSnapshot', 'Health checks could not be loaded.');
          byId('monitorServices').innerHTML = '<tr><td colspan="6">No health checks loaded. Use Refresh checks to retry.</td></tr>';
          byId('monitorFailureHistory').innerHTML = '<tr><td colspan="3">No history loaded.</td></tr>';
          text('monitorIncidents', 'No failed checks loaded.');
          text('monitorEvents', 'No audit events loaded.');
        }
        text('monitorStatus', (current ? 'Displayed data is stale. ' : '') + error.message + ' Use Refresh to retry.');
        byId('monitorStatus').classList.add('text-warning');
      } finally {
        busy = false;
        byId('btnRefreshMonitoring').disabled = false;
        section.setAttribute('aria-busy', 'false');
        if (query !== selectedQuery()) load(false);
      }
    }
    byId('btnRefreshMonitoring').addEventListener('click', () => load(true));
    ['monitorRange', 'monitorService'].forEach(id => byId(id).addEventListener('change', () => { byId('btnExportMonitoring').disabled = true; load(false); }));
    byId('btnExportMonitoring').addEventListener('click', () => {
      if (!current || busy || selectedQuery() !== new URLSearchParams({ range: current.range, service: current.service }).toString()) return;
      const rows = [['Period (PHT)', 'Checks', 'Failures', 'API p95 (ms)', 'PHP peak memory mean (MiB)'], ...current.history.map(row => [row.label, row.checks, row.failed, row.p95_ms ?? '', row.memory_mib ?? ''])];
      const csv = rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'monitoring-' + current.range + '-' + current.service + '.csv'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    load(true);
    setInterval(() => { if (!document.hidden) load(true); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
  };
})();
