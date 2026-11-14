(function () {
  'use strict';

  window.initLiveMaintenance = function ({ byId, showToast, escapeHtml, getCsrfToken, refreshOverview }) {
    let current = null;
    let busy = false;
    let loading = false;
    let revision = 0;
    let scheduleDirty = false;
    let announcementDirty = false;
    const module = byId('module-maintenance');
    const disableDialog = byId('disableMaintenanceModal');
    const disableConfirm = byId('btnConfirmDisableMaintenance');
    const disableCancel = byId('btnCancelDisableMaintenance');
    // Escape the section's scroll-reveal transform and the blurred page content.
    document.body.appendChild(disableDialog);
    const disableModal = bootstrap.Modal.getOrCreateInstance(disableDialog);
    let disableDialogShown = false;
    const endpoint = 'public/api/super-admin/maintenance.php';
    const value = id => byId(id).value.trim();
    const historyValue = text => '<div class="maintenance-history-value" tabindex="0">' + escapeHtml(text) + '</div>';

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

    function fillSchedule(data) {
      const w = data.window || {};
      const [startDate, startTime] = dateParts(w.start_at);
      const [endDate, endTime] = dateParts(w.end_at);
      byId('maintenanceState').value = w.status || 'Draft';
      byId('maintenanceStartDate').value = startDate;
      byId('maintenanceStartTime').value = startTime;
      byId('maintenanceEndDate').value = endDate;
      byId('maintenanceEndTime').value = endTime;
      byId('maintenancePurpose').value = w.purpose || '';
      byId('maintenanceNotifyUsers').checked = !!w.notify_users;
      scheduleDirty = false;
    }

    function fillAnnouncement(data) {
      const a = data.announcement || {};
      byId('announcementTitle').value = a.title || '';
      byId('announcementMessage').value = a.message || '';
      byId('announcementLocation').value = a.location || 'Application-wide';
      announcementDirty = false;
      preview();
    }

    function preview() {
      const title = value('announcementTitle');
      const message = value('announcementMessage');
      byId('announcementPreviewText').textContent = [title, message].filter(Boolean).join(' — ') || 'No announcement saved.';
    }

    function updateControls() {
      module.setAttribute('aria-busy', String(busy || loading));
      module.querySelectorAll('button, input, select, textarea').forEach(control => {
        control.disabled = busy || !current;
      });
      byId('btnEnableMaintenance').disabled = busy || !current || !!current.manual_mode;
      byId('btnDisableMaintenance').disabled = busy || !current?.manual_mode;
      byId('btnDisableMaintenance').title = current?.scheduled_active
        ? 'Scheduled maintenance ends at its end time, or when its schedule is saved as Cancelled.' : '';
      disableConfirm.disabled = busy || !current?.manual_mode || !disableDialogShown;
      disableCancel.disabled = busy;
    }

    function confirmation(open, returnFocus = false) {
      byId('enableMaintenancePanel').hidden = !open;
      byId('btnEnableMaintenance').setAttribute('aria-expanded', String(open));
      byId('enableMaintenancePhrase').value = '';
      byId('enableMaintenanceCheck').checked = false;
      if (open) byId('enableMaintenancePhrase').focus();
      else if (returnFocus) byId('btnEnableMaintenance').focus();
    }

    function render(data) {
      current = data;
      const active = !!data.active;
      byId('maintenanceAvailability').textContent = active ? 'Maintenance' : 'Available';
      byId('maintenanceAvailability').classList.toggle('text-warning', active);
      byId('maintenanceAvailability').classList.toggle('text-accent', !active);
      byId('maintenanceModeValue').textContent = active ? 'On' : 'Off';
      byId('maintenanceModeSub').textContent = data.scheduled_active
        ? (data.manual_mode ? 'Manual mode and scheduled window active' : 'Scheduled window active')
        : (data.manual_mode ? 'Manually enabled' : 'No current restriction');
      if (data.manual_mode) confirmation(false);
      byId('disableMaintenanceDescription').textContent = data.scheduled_active
        ? 'The scheduled window will remain active until it ends or is cancelled. Only manual maintenance will be disabled.'
        : 'This will resume access to the application. The change will be recorded.';
      if (!data.manual_mode && disableDialogShown && !busy) disableModal.hide();

      const w = data.window || {};
      const upcoming = w.status === 'Scheduled' && w.start_at > data.server_time;
      byId('nextWindowValue').textContent = upcoming ? w.start_at.slice(5, 10).replace('-', ' / ') : 'None';
      byId('nextWindowSub').textContent = upcoming ? w.start_at.slice(0, 16) + ' – ' + w.end_at.slice(0, 16) + ' PHT' : 'No scheduled window';

      const rows = [];
      if (w.start_at) {
        const status = data.scheduled_active ? 'Active' : (w.status === 'Scheduled' && w.end_at <= data.server_time ? 'Completed' : w.status);
        rows.push('<tr><td>' + escapeHtml(w.start_at.slice(0, 16)) + ' – ' + escapeHtml(w.end_at.slice(0, 16)) +
          '</td><td>' + historyValue(w.purpose) + '</td><td>Entire application</td><td>' + escapeHtml(status) +
          '</td><td>Super Admin only</td><td><button type="button" class="btn btn-link p-0 text-light-cc" id="maintenanceEditRow">Edit</button></td></tr>');
      }
      (data.history || []).forEach(entry => {
        const detail = entry.metadata || {};
        const description = entry.action === 'maintenance.window_saved'
          ? (detail.purpose || 'Window updated') + ' · ' + (detail.status || '')
          : entry.action === 'maintenance.announcement_saved' ? 'Announcement saved: ' + (detail.title || '')
          : entry.action === 'maintenance.enabled' ? 'Maintenance enabled'
          : entry.action === 'maintenance.disabled' ? 'Maintenance disabled' : entry.action;
        rows.push('<tr><td>' + escapeHtml(entry.created_at) + '</td><td>' + historyValue(description) +
          '</td><td>Entire application</td><td>Recorded</td><td>' + historyValue(entry.actor || 'Super Admin') + '</td><td>—</td></tr>');
      });
      const history = rows.length ? rows.join('') : '<tr><td colspan="6">No maintenance activity yet.</td></tr>';
      if (byId('maintenanceHistoryBody').innerHTML !== history) byId('maintenanceHistoryBody').innerHTML = history;
      if (!scheduleDirty) fillSchedule(data);
      if (!announcementDirty) fillAnnouncement(data);
      byId('maintenanceDataFootnote').textContent = 'Live maintenance data · PHT';
    }

    async function load() {
      if (busy || loading) return;
      loading = true;
      const version = revision;
      updateControls();
      try {
        const data = await request();
        if (version === revision) render(data);
      }
      catch (error) {
        if (version !== revision) return;
        if (!current) {
          byId('maintenanceAvailability').textContent = 'Unavailable';
          byId('maintenanceModeSub').textContent = 'Unable to load maintenance state';
          byId('nextWindowSub').textContent = 'Schedule unavailable';
          byId('maintenanceHistoryBody').innerHTML = '<tr><td colspan="6">Unable to load maintenance data.</td></tr>';
        }
        byId('maintenanceDataFootnote').textContent = 'Unable to refresh maintenance data. Retrying automatically.';
        showToast(error.message, 'error');
      } finally { loading = false; updateControls(); }
    }

    async function mutate(body, success) {
      if (busy || !current) return;
      busy = true;
      revision++;
      updateControls();
      let saved = false;
      try {
        const data = await request(body);
        if (body.action === 'save_window') scheduleDirty = false;
        if (body.action === 'save_announcement') announcementDirty = false;
        render(data);
        saved = true;
        refreshOverview();
        showToast(body.action === 'disable' && data.scheduled_active
          ? 'Manual maintenance disabled. The scheduled window is still active.' : success);
      } catch (error) { showToast(error.message, 'error'); }
      finally {
        busy = false;
        updateControls();
        if (saved && body.action === 'enable') byId('btnDisableMaintenance').focus();
      }
      return saved;
    }

    byId('btnEnableMaintenance').addEventListener('click', () => {
      if (!busy && current && !current.manual_mode) confirmation(true);
    });
    byId('btnCancelEnableMaintenance').addEventListener('click', () => {
      confirmation(false, true);
    });
    byId('btnConfirmEnableMaintenance').addEventListener('click', () => {
      if (byId('enableMaintenancePanel').hidden || busy || !current || current.manual_mode) return;
      if (value('enableMaintenancePhrase') !== 'ENABLE MAINTENANCE / ENTIRE APPLICATION' || !byId('enableMaintenanceCheck').checked) {
        showToast('Enter the exact confirmation phrase and tick the checkbox.', 'warning');
        byId('enableMaintenancePhrase').focus();
        return;
      }
      mutate({ action: 'enable' }, 'Maintenance enabled.');
    });
    byId('btnDisableMaintenance').addEventListener('click', () => {
      if (!current?.manual_mode) {
        showToast(current?.scheduled_active ? 'Cancel the active scheduled window to end it.' : 'Maintenance mode is already off.', 'warning');
        return;
      }
      if (!busy) disableModal.show();
    });
    disableDialog.addEventListener('show.bs.modal', () => {
      document.body.classList.add('cc-maintenance-disable-modal-open');
    });
    disableDialog.addEventListener('shown.bs.modal', () => {
      disableDialogShown = true;
      updateControls();
      disableCancel.focus();
    });
    disableDialog.addEventListener('hide.bs.modal', event => {
      if (busy) { event.preventDefault(); return; }
      disableDialogShown = false;
      updateControls();
    });
    disableDialog.addEventListener('hidden.bs.modal', () => {
      document.body.classList.remove('cc-maintenance-disable-modal-open');
      byId(current?.manual_mode ? 'btnDisableMaintenance' : 'btnEnableMaintenance').focus();
    });
    disableConfirm.addEventListener('click', async () => {
      if (busy || !disableDialogShown || !current?.manual_mode) return;
      disableConfirm.textContent = 'Disabling…';
      if (await mutate({ action: 'disable' }, 'Maintenance disabled.')) disableModal.hide();
      disableConfirm.textContent = 'Disable';
    });
    byId('maintenanceHistoryBody').addEventListener('click', event => {
      if (event.target.closest('#maintenanceEditRow') && !busy && current) {
        fillSchedule(current);
        byId('maintenanceStartDate').focus();
      }
    });
    byId('btnCancelSchedule').addEventListener('click', () => { if (current && !busy) fillSchedule(current); });
    ['input', 'change'].forEach(type => {
      byId('maintenanceForm').addEventListener(type, () => { scheduleDirty = true; });
      byId('announcementForm').addEventListener(type, () => { announcementDirty = true; });
    });
    byId('maintenanceForm').addEventListener('submit', event => {
      event.preventDefault();
      if (!byId('maintenanceForm').reportValidity()) return;
      const start_at = value('maintenanceStartDate') + ' ' + value('maintenanceStartTime');
      const end_at = value('maintenanceEndDate') + ' ' + value('maintenanceEndTime');
      if (end_at <= start_at) { showToast('End must be after start.', 'error'); return; }
      if (!value('maintenancePurpose')) {
        showToast('Enter a maintenance purpose.', 'warning');
        byId('maintenancePurpose').focus();
        return;
      }
      mutate({ action: 'save_window', status: value('maintenanceState'), start_at, end_at,
        purpose: value('maintenancePurpose'), notify_users: byId('maintenanceNotifyUsers').checked }, 'Maintenance schedule saved.');
    });
    byId('btnPreviewAnnouncement').addEventListener('click', preview);
    byId('announcementForm').addEventListener('submit', event => {
      event.preventDefault();
      if (!byId('announcementForm').reportValidity()) return;
      if (!value('announcementTitle') || !value('announcementMessage')) {
        showToast('Enter an announcement title and message.', 'warning');
        byId(!value('announcementTitle') ? 'announcementTitle' : 'announcementMessage').focus();
        return;
      }
      mutate({ action: 'save_announcement', title: value('announcementTitle'), message: value('announcementMessage'),
        location: value('announcementLocation') }, 'Maintenance announcement saved.');
    });

    load();
    setInterval(() => { if (!document.hidden && !busy) load(); }, 60000);
  };
})();
