(function () {
  'use strict';
  window.initSystemConfiguration = function ({ byId, showToast, getCsrfToken }) {
    const form = byId('configForm');
    const fields = byId('configFields');
    const controls = Array.from(form.querySelectorAll('[data-config-key]'));
    const status = byId('configStatus');
    const review = byId('configReview');
    const confirm = byId('configConfirm');
    const save = byId('btnConfigSave');
    const reload = byId('btnConfigReload');
    let saved = null;
    let busy = false;
    let reviewed = null;
    function draft() {
      return Object.fromEntries(controls.map(function (el) {
        const key = el.dataset.configKey;
        const value = el.type === 'checkbox' ? el.checked
          : key === 'registration_enabled' ? el.value === 'true'
          : key === 'report_period' ? el.value : Number(el.value);
        return [key, value];
      }));
    }
    function changes() {
      const values = draft();
      return controls.filter(el => values[el.dataset.configKey] !== saved.settings[el.dataset.configKey]);
    }
    function update() {
      reviewed = null;
      review.hidden = true;
      confirm.checked = false;
      save.disabled = true;
      if (!saved) return;
      const count = changes().length;
      status.textContent = (saved.saved_at ? 'Last saved: ' + new Date(saved.saved_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT · User #' + saved.saved_by : 'Existing application defaults; no configuration saved yet.') + ' · ' + count + ' unsaved change(s).';
      byId('btnConfigReview').disabled = count === 0;
    }
    function restore() {
      controls.forEach(function (el) {
        const value = saved.settings[el.dataset.configKey];
        if (el.type === 'checkbox') el.checked = value;
        else el.value = String(value);
      });
      update();
    }
    async function request(options) {
      const response = await fetch('public/api/super-admin/configuration.php', {
        credentials: 'same-origin', cache: 'no-store', ...options
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || 'Configuration request failed.');
      return payload.data;
    }
    async function load() {
      if (busy) return;
      busy = true;
      fields.disabled = true;
      reload.disabled = true;
      status.textContent = 'Loading saved configuration…';
      try {
        saved = await request({ headers: { Accept: 'application/json' } });
        restore();
        fields.disabled = false;
      } catch (error) {
        status.textContent = error.message + ' Use Reload saved configuration to retry.';
        showToast(error.message, 'error');
      } finally { busy = false; reload.disabled = false; }
    }
    form.addEventListener('change', function (event) {
      if (event.target === confirm) {
        save.disabled = !confirm.checked || !reviewed || reviewed !== JSON.stringify(draft());
      } else if (event.target.dataset.configKey) update();
    });
    form.addEventListener('reset', function (event) {
      event.preventDefault();
      if (!busy && saved) restore();
    });
    reload.addEventListener('click', function () {
      if (saved && changes().length && !window.confirm('Discard unsaved changes and reload the saved configuration?')) return;
      load();
    });
    byId('btnConfigReview').addEventListener('click', function () {
      if (!saved || busy || !changes().length) return;
      const values = draft();
      const list = byId('configChanges');
      list.replaceChildren();
      changes().forEach(function (el) {
        const key = el.dataset.configKey;
        const label = form.querySelector('label[for="' + el.id + '"]').textContent;
        const display = value => el.type === 'checkbox' ? (value ? 'Enabled' : 'Disabled')
          : Array.from(el.options).find(option => option.value === String(value))?.textContent || String(value);
        const item = document.createElement('li');
        item.textContent = label + ': ' + display(saved.settings[key]) + ' → ' + display(values[key]);
        list.appendChild(item);
      });
      reviewed = JSON.stringify(values);
      confirm.checked = false;
      save.disabled = true;
      review.hidden = false;
      review.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy || !saved || !confirm.checked || !reviewed || reviewed !== JSON.stringify(draft())) return;
      const settings = draft();
      busy = true;
      fields.disabled = true;
      reload.disabled = true;
      try {
        const token = await getCsrfToken(true);
        saved = await request({ method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ settings, version: saved.version, confirmed: true }) });
        restore();
        showToast('Global configuration saved.', 'success');
      } catch (error) {
        update();
        status.textContent = error.message + ' Your draft is retained.';
        showToast(error.message, 'error');
      } finally { busy = false; fields.disabled = false; reload.disabled = false; }
    });
    window.addEventListener('beforeunload', function (event) {
      if (saved && changes().length) { event.preventDefault(); event.returnValue = ''; }
    });
    load();
  };
}());
