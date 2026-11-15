(function () {
  'use strict';
  window.initSuperAdminAccount = function ({ byId, showToast, getCsrfToken, updateIdentity }) {
    const module = byId('module-account');
    if (module.dataset.initialized) return;
    module.dataset.initialized = 'true';
    const profileForm = byId('accountProfileForm');
    const credentialsForm = byId('credentialsForm');
    const historyModal = byId('accountHistoryModal');
    const historyItems = byId('accountHistoryItems');
    const historyViewport = byId('accountHistoryViewport');
    const historyMore = byId('btnAccountHistoryMore');
    const fields = { first_name: 'accountFirstName', last_name: 'accountLastName', email: 'accountEmail', mobile: 'accountMobile' };
    const labels = { 'auth.login': 'Signed in', 'auth.registration': 'Account registered', 'account.profile_updated': 'Profile updated', 'account.password_changed': 'Password changed' };
    let saved = null;
    let busy = false;
    let historyBusy = false;
    let historyController = null;
    let before = null;
    const date = value => value ? new Date(Number(value) * 1000).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT' : 'Unavailable';
    const detail = item => (labels[item.action] || item.action)
      + (item.description ? ' — ' + item.description : '')
      + (item.entity_type ? ' · ' + item.entity_type + (item.entity_id ? ' #' + item.entity_id : '') : '');

    async function request(query = '', body = null, signal) {
      const response = await fetch('public/api/super-admin/account.php' + query, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrfToken() } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || 'Account request failed.');
      return payload.data;
    }

    function controls() {
      module.setAttribute('aria-busy', String(busy));
      [profileForm, credentialsForm].forEach(form => Array.from(form.elements).forEach(el => { el.disabled = busy || !saved; }));
      byId('btnReloadAccount').disabled = busy;
      byId('btnAccountHistory').disabled = busy || !saved;
    }

    function restoreProfile() {
      if (!saved) return;
      Object.entries(fields).forEach(([key, id]) => { byId(id).value = saved.profile[key] || ''; });
    }

    function render(data, restore) {
      saved = data;
      if (restore) restoreProfile();
      updateIdentity(data.profile);
      const policy = data.password_policy;
      byId('credentialNew').minLength = policy.minimum;
      byId('credentialConfirm').minLength = policy.minimum;
      byId('accountPasswordPolicy').textContent = 'At least ' + policy.minimum + ' characters, including a letter and a number. '
        + (policy.invalidate_sessions ? 'Changing your password signs out other sessions on their next request.' : 'Changing your password keeps other sessions signed in.');
      byId('accountCurrentSession').textContent = 'Signed in: ' + date(data.session.logged_in_at) + ' · Last activity: ' + date(data.session.last_activity_at);
      const activity = byId('accountActivity');
      activity.replaceChildren();
      if (!data.history.items.length) activity.textContent = 'No administrative activity recorded for your account.';
      data.history.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'sa-list-row';
        const title = document.createElement('div');
        title.className = 'sa-list-title';
        title.textContent = date(item.timestamp);
        const description = document.createElement('div');
        description.className = 'sa-list-meta';
        description.textContent = detail(item);
        row.append(title, description);
        activity.append(row);
      });
      byId('accountStatus').textContent = 'Times are displayed in Asia/Manila (PHT).';
    }

    async function run(body = null, message = '') {
      if (busy) return;
      busy = true;
      controls();
      byId('accountStatus').textContent = body ? 'Saving...' : 'Loading account...';
      try {
        render(await request('', body), !saved || !body || body.action === 'update_profile');
        if (body?.action === 'update_password') credentialsForm.reset();
        if (message) showToast(message, 'success');
      } catch (error) {
        byId('accountStatus').textContent = error.message + (!saved ? ' Use Reload account to retry.' : '');
        showToast(error.message, 'error');
      } finally {
        busy = false;
        controls();
      }
    }

    profileForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!profileForm.reportValidity()) return;
      const body = { action: 'update_profile' };
      Object.entries(fields).forEach(([key, id]) => { body[key] = byId(id).value.trim(); });
      run(body, 'Profile saved.');
    });
    byId('btnCancelProfile').addEventListener('click', restoreProfile);
    credentialsForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!credentialsForm.reportValidity()) return;
      const next = byId('credentialNew').value;
      const confirmation = byId('credentialConfirm').value;
      if (next !== confirmation) return showToast('Passwords do not match.', 'error');
      run({ action: 'update_password', current_password: byId('credentialCurrent').value, new_password: next, password_confirmation: confirmation }, 'Password changed.');
    });
    byId('btnCancelCredentials').addEventListener('click', () => credentialsForm.reset());
    byId('btnReloadAccount').addEventListener('click', () => run());

    function historyMessage(message) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.textContent = message;
      row.append(cell);
      historyItems.replaceChildren(row);
    }

    async function loadHistory(append = false) {
      if (append && historyBusy) return;
      historyController?.abort();
      const controller = new AbortController();
      const restoreFocus = document.activeElement === historyMore;
      historyController = controller;
      historyBusy = true;
      historyMore.disabled = true;
      historyViewport.setAttribute('aria-busy', 'true');
      byId('accountHistoryStatus').textContent = 'Loading audit history...';
      if (!append) {
        before = null;
        historyMore.hidden = true;
        historyViewport.scrollTop = 0;
        historyMessage('Loading audit history...');
      }
      try {
        const data = await request('?view=history' + (append && before ? '&before=' + before : ''), null, controller.signal);
        if (controller.signal.aborted) return;
        if (!append) historyItems.replaceChildren();
        data.items.forEach(item => {
          const row = document.createElement('tr');
          [date(item.timestamp), detail(item)].forEach(value => {
            const cell = document.createElement('td');
            const content = document.createElement('div');
            content.className = 'account-history-value';
            content.tabIndex = 0;
            content.textContent = value;
            cell.append(content);
            row.append(cell);
          });
          historyItems.append(row);
        });
        if (!historyItems.children.length) historyMessage('No administrative activity recorded for your account.');
        before = data.next_before;
        historyMore.hidden = !before;
        historyMore.textContent = 'Load more';
        byId('accountHistoryStatus').textContent = 'Times are displayed in Asia/Manila (PHT). Newest activity first.';
      } catch (error) {
        if (controller.signal.aborted) return;
        showToast(error.message, 'error');
        byId('accountHistoryStatus').textContent = error.message;
        if (!append) historyMessage('Unable to load audit history. Use Retry to try again.');
        historyMore.textContent = 'Retry';
        historyMore.hidden = false;
      } finally {
        if (historyController === controller) {
          historyBusy = false;
          historyMore.disabled = false;
          historyViewport.setAttribute('aria-busy', 'false');
          if (restoreFocus && !controller.signal.aborted) {
            (historyMore.hidden ? historyViewport : historyMore).focus({ preventScroll: true });
          }
        }
      }
    }
    byId('btnAccountHistory').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(historyModal).show());
    historyModal.addEventListener('show.bs.modal', () => loadHistory());
    historyModal.addEventListener('hide.bs.modal', () => historyController?.abort());
    historyModal.addEventListener('hidden.bs.modal', () => byId('btnAccountHistory').focus());
    historyMore.addEventListener('click', () => loadHistory(Boolean(before)));
    run();
  };
})();
