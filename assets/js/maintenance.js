(function () {
  'use strict';

  window.initLiveMaintenance = function ({ byId, showToast, escapeHtml, getCsrfToken, refreshOverview }) {
    let current = null;
    let busy = false;
    const endpoint = 'public/api/super-admin/maintenance.php';
    const value = id => byId(id).value.trim();

    async function request(body, retry = false) {
      const headers = { Accept: 'application/json' };
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['X-CSRF-Token'] = await getCsrfToken(retry);
      }
      const response = await fetch(endpoint, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin', cache: 'no-store', headers,
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        if (body && response.status === 403 && !retry) return request(body, true);
        throw new Error(payload.error?.message || 'Maintenance request failed.');
      }
      return payload.data;
    }

    function dateParts(stamp) {
      return stamp ? [stamp.slice(0, 10), stamp.slice(11, 16)] : ['', ''];
    }

    function fillForms(data) {
      const w = data.window || {};
      const a = data.announcement || {};
      const [startDate, startTime] = dateParts(w.start_at);
      const [endDate, endTime] = dateParts(w.end_at);
      byId('maintenanceState').value = w.status || 'Draft';
      byId('maintenanceStartDate').value = startDate;
      byId('maintenanceStartTime').value = startTime;
      byId('maintenanceEndDate').value = endDate;
      byId('maintenanceEndTime').value = endTime;
      byId('maintenancePurpose').value = w.purpose || '';
      byId('maintenanceNotifyUsers').checked = !!w.notify_users;
      byId('announcementTitle').value = a.title || '';
      byId('announcementMessage').value = a.message || '';
      byId('announcementLocation').value = a.location || 'Application-wide';
      preview();
    }

    function preview() {
      const title = value('announcementTitle');
      const message = value('announcementMessage');
      byId('announcementPreviewText').textContent = title && message ? title + ' — ' + message : 'No announcement saved.';
    }

    function render(data, fill = true) {
      current = data;
      const active = !!data.active;
      byId('maintenanceAvailability').textContent = active ? 'Maintenance' : 'Available';
      byId('maintenanceAvailability').classList.toggle('text-warning', active);
      byId('maintenanceAvailability').classList.toggle('text-accent', !active);
      byId('maintenanceModeValue').textContent = active ? 'On' : 'Off';
      byId('maintenanceModeSub').textContent = data.scheduled_active ? 'Scheduled window active' : (data.manual_mode ? 'Manually enabled' : 'No current restriction');
      byId('maintenanceEditorBadge').textContent = 'Current: ' + (active ? 'On' : 'Off');
      byId('btnDisableMaintenance').textContent = 'Disable maintenance · current ' + (active ? 'On' : 'Off');

      const w = data.window || {};
      const upcoming = w.status === 'Scheduled' && w.start_at > data.server_time;
      byId('nextWindowValue').textContent = upcoming ? w.start_at.slice(5, 10).replace('-', ' / ') : 'None';
      byId('nextWindowSub').textContent = upcoming ? w.start_at.slice(0, 16) + '–' + w.end_at.slice(11, 16) + ' PHT' : 'No scheduled window';

      const rows = [];
      if (w.start_at) {
        const status = w.status === 'Scheduled' && w.end_at <= data.server_time ? 'Completed' : w.status;
        rows.push('<tr><td>' + escapeHtml(w.start_at.slice(0, 16)) + '–' + escapeHtml(w.end_at.slice(11, 16)) +
          '</td><td>' + escapeHtml(w.purpose) + '</td><td>Entire application</td><td>' + escapeHtml(status) +
          '</td><td>Super Admin only</td><td><button type="button" class="btn btn-link p-0 text-light-cc" id="maintenanceEditRow">Edit</button></td></tr>');
      }
      (data.history || []).forEach(entry => {
        const detail = entry.metadata || {};
        const description = entry.action === 'maintenance.window_saved'
          ? (detail.purpose || 'Window updated') + ' · ' + (detail.status || '')
          : entry.action === 'maintenance.announcement_saved' ? 'Announcement saved: ' + (detail.title || '')
          : entry.action === 'maintenance.enabled' ? 'Maintenance enabled' : 'Maintenance disabled';
        rows.push('<tr><td>' + escapeHtml(entry.created_at) + '</td><td>' + escapeHtml(description) +
          '</td><td>Entire application</td><td>Recorded</td><td>' + escapeHtml(entry.actor || 'Super Admin') + '</td><td>—</td></tr>');
      });
      byId('maintenanceHistoryBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="6">No maintenance activity yet.</td></tr>';
      byId('maintenanceEditRow')?.addEventListener('click', () => byId('maintenanceStartDate').focus());
      if (fill) fillForms(data);
    }

    async function load(fill = true) {
      try { render(await request(), fill); }
      catch (error) {
        byId('maintenanceHistoryBody').innerHTML = '<tr><td colspan="6">Unable to load maintenance data.</td></tr>';
        showToast(error.message, 'error');
      }
    }

    async function mutate(body, success) {
      if (busy) return;
      busy = true;
      try {
        render(await request(body));
        refreshOverview();
        showToast(success);
      } catch (error) { showToast(error.message, 'error'); }
      finally { busy = false; }
    }

    byId('btnEnableMaintenance').addEventListener('click', () => {
      byId('enableMaintenancePhrase').value = '';
      byId('enableMaintenanceCheck').checked = false;
      byId('enableMaintenancePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    byId('btnCancelEnableMaintenance').addEventListener('click', () => {
      byId('enableMaintenancePhrase').value = '';
      byId('enableMaintenanceCheck').checked = false;
    });
    byId('btnConfirmEnableMaintenance').addEventListener('click', () => {
      if (value('enableMaintenancePhrase') !== 'ENABLE MAINTENANCE / ENTIRE APPLICATION' || !byId('enableMaintenanceCheck').checked) {
        showToast('Enter the exact confirmation phrase and tick the checkbox.', 'warning');
        return;
      }
      mutate({ action: 'enable' }, 'Maintenance enabled.');
    });
    byId('btnDisableMaintenance').addEventListener('click', () => {
      if (!current?.manual_mode) {
        showToast(current?.scheduled_active ? 'Cancel the active scheduled window to end it.' : 'Maintenance mode is already off.', 'warning');
        return;
      }
      if (window.confirm('Disable application-wide maintenance now? This action is recorded.')) {
        mutate({ action: 'disable' }, 'Maintenance disabled.');
      }
    });
    byId('btnEditSchedule').addEventListener('click', () => byId('maintenanceStartDate').focus());
    byId('btnCancelSchedule').addEventListener('click', () => { if (current) fillForms(current); });
    byId('maintenanceForm').addEventListener('submit', event => {
      event.preventDefault();
      const start_at = value('maintenanceStartDate') + ' ' + value('maintenanceStartTime');
      const end_at = value('maintenanceEndDate') + ' ' + value('maintenanceEndTime');
      if (end_at <= start_at) { showToast('End must be after start.', 'error'); return; }
      mutate({ action: 'save_window', status: value('maintenanceState'), start_at, end_at,
        purpose: value('maintenancePurpose'), notify_users: byId('maintenanceNotifyUsers').checked }, 'Maintenance schedule saved.');
    });
    byId('btnPreviewAnnouncement').addEventListener('click', preview);
    byId('announcementForm').addEventListener('submit', event => {
      event.preventDefault();
      mutate({ action: 'save_announcement', title: value('announcementTitle'), message: value('announcementMessage'),
        location: value('announcementLocation') }, 'Maintenance announcement saved.');
    });

    load();
    setInterval(() => { if (!document.hidden && !busy) load(false); }, 60000);
  };
})();
