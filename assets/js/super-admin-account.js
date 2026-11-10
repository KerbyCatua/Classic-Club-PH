(function () {
  'use strict';
  window.initSuperAdminAccount = function ({ byId, showToast, getCsrfToken, updateIdentity }) {
    const profileForm = byId('accountProfileForm');
    const credentialsForm = byId('credentialsForm');
    const fields = { first_name: 'accountFirstName', last_name: 'accountLastName', email: 'accountEmail', mobile: 'accountMobile' };
    let saved = null;
    let busy = false;
    let historyBusy = false;
    let before = null;
    const date = value => value ? new Date(Number(value) * 1000).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT' : 'Unavailable';

    async function request(query = '', body = null) {
      const response = await fetch('public/api/super-admin/account.php' + query, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrfToken() } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || 'Account request failed.');
      return payload.data;
    }

    function controls() {
      [profileForm, credentialsForm].forEach(form => Array.from(form.elements).forEach(el => { el.disabled = busy || !saved; }));
      ['btnReloadAccount', 'btnReviewRecovery', 'btnRequestAccountRecovery', 'btnAccountHistory'].forEach(id => {
        byId(id).disabled = busy || (id !== 'btnReloadAccount' && !saved);
      });
    }

    function activity(container, items, append = false) {
      if (!append) container.replaceChildren();
      if (!items.length && !append) container.textContent = 'No administrative activity recorded for your account.';
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'sa-list-row';
        const title = document.createElement('div');
        title.className = 'sa-list-title';
        title.textContent = date(item.timestamp);
        const detail = document.createElement('div');
        detail.className = 'sa-list-meta';
        const labels = { 'auth.login': 'Signed in', 'auth.registration': 'Account registered', 'account.profile_updated': 'Profile updated', 'account.password_changed': 'Password changed', 'users.password_reset_requested': 'Password recovery requested' };
        detail.textContent = (labels[item.action] || item.action) + (item.description ? ' — ' + item.description : '')
          + (item.entity_type ? ' · ' + item.entity_type + (item.entity_id ? ' #' + item.entity_id : '') : '');
        row.append(title, detail);
        container.append(row);
      });
    }

    function restoreProfile() {
      if (!saved) return;
      Object.entries(fields).forEach(([key, id]) => { byId(id).value = saved.profile[key] || ''; });
    }

    function render(data) {
      saved = data;
      restoreProfile();
      updateIdentity(data.profile);
      const policy = data.password_policy;
      byId('credentialNew').minLength = policy.minimum;
      byId('credentialConfirm').minLength = policy.minimum;
      byId('accountPasswordPolicy').textContent = 'At least ' + policy.minimum + ' characters, including a letter and a number. Your current password verifies this change. '
        + (policy.invalidate_sessions ? 'Other sessions are rejected on their next authenticated request after a password change.' : 'The saved global policy does not invalidate other sessions after password changes.');
      byId('accountCurrentSession').textContent = 'Signed in: ' + date(data.session.logged_in_at) + ' · Last activity: ' + date(data.session.last_activity_at);
      const reset = data.recovery.latest_request;
      const recovery = 'Account email: ' + data.profile.email + (data.profile.email_verified_at ? ' (verified).' : ' (not verified).')
        + (reset ? ' Latest recovery request: ' + date(reset.created_at) + '. Status: ' + (reset.used_at ? 'used or invalidated' : Number(reset.expires_at) > Date.now() / 1000 ? 'pending until ' + date(reset.expires_at) : 'expired') + '.' : ' No recovery request recorded.');
      byId('accountRecovery').textContent = recovery;
      byId('accountRecoveryDetail').textContent = recovery;
      activity(byId('accountActivity'), data.history.items);
      byId('accountStatus').textContent = 'Account loaded. Times are displayed in Asia/Manila.';
    }

    async function run(body = null, message = '') {
      if (busy) return;
      busy = true;
      controls();
      byId('accountStatus').textContent = body ? 'Saving...' : 'Loading account...';
      try {
        render(await request('', body));
        if (body?.action === 'update_password') credentialsForm.reset();
        if (message) showToast(message, 'success');
      } catch (error) {
        byId('accountStatus').textContent = error.message + ' Use Reload account to retry.';
        showToast(error.message, 'error');
      } finally {
        busy = false;
        controls();
      }
    }

    profileForm.addEventListener('submit', event => {
      event.preventDefault();
      const body = { action: 'update_profile' };
      Object.entries(fields).forEach(([key, id]) => { body[key] = byId(id).value.trim(); });
      run(body, 'Profile saved.');
    });
    byId('btnCancelProfile').addEventListener('click', restoreProfile);
    credentialsForm.addEventListener('submit', event => {
      event.preventDefault();
      const next = byId('credentialNew').value;
      const confirmation = byId('credentialConfirm').value;
      if (next !== confirmation) return showToast('Passwords do not match.', 'error');
      run({ action: 'update_password', current_password: byId('credentialCurrent').value, new_password: next, password_confirmation: confirmation }, 'Password changed.');
    });
    byId('btnCancelCredentials').addEventListener('click', () => credentialsForm.reset());
    byId('btnReloadAccount').addEventListener('click', () => run());
    byId('btnReviewRecovery').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(byId('accountRecoveryModal')).show());
    byId('btnRequestAccountRecovery').addEventListener('click', () => run({ action: 'request_recovery' }, 'Recovery request recorded. Administrative support is required to complete recovery.'));

    async function loadHistory(append = false) {
      if (historyBusy) return;
      historyBusy = true;
      byId('btnAccountHistoryMore').disabled = true;
      try {
        const data = await request('?view=history' + (append && before ? '&before=' + before : ''));
        activity(byId('accountHistoryItems'), data.items, append);
        before = data.next_before;
        byId('btnAccountHistoryMore').hidden = !before;
      } catch (error) {
        showToast(error.message, 'error');
        if (!append) byId('accountHistoryItems').textContent = error.message;
      } finally {
        historyBusy = false;
        byId('btnAccountHistoryMore').disabled = false;
      }
    }
    byId('btnAccountHistory').addEventListener('click', () => {
      byId('accountHistoryItems').textContent = 'Loading audit history...';
      byId('btnAccountHistoryMore').hidden = true;
      bootstrap.Modal.getOrCreateInstance(byId('accountHistoryModal')).show();
      loadHistory();
    });
    byId('btnAccountHistoryMore').addEventListener('click', () => loadHistory(true));
    run();
  };
})();
