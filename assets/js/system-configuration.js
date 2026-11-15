(function () {
  'use strict';
  window.initSystemConfiguration = function ({ byId, showToast, getCsrfToken }) {
    const form = byId('configForm');
    if (!form) return;
    const module = byId('module-config');
    const fields = byId('configFields');
    const controls = Array.from(form.querySelectorAll('[data-config-key]'));
    const status = byId('configStatus');
    const review = byId('configReview');
    const confirm = byId('configConfirm');
    const save = byId('btnConfigSave');
    const reload = byId('btnConfigReload');
    const reviewButton = byId('btnConfigReview');
    const discard = byId('btnConfigDiscard');
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
      if (!saved) return [];
      const values = draft();
      return controls.filter(el => values[el.dataset.configKey] !== saved.settings[el.dataset.configKey]);
    }
    function render() {
      const dirty = changes().length > 0;
      module.setAttribute('aria-busy', String(busy));
      fields.disabled = busy || !saved;
      reload.disabled = busy;
      discard.disabled = busy || !dirty;
      reviewButton.disabled = busy || !dirty;
      reviewButton.classList.toggle('d-none', Boolean(reviewed));
      review.classList.toggle('d-none', !reviewed);
      save.classList.toggle('d-none', !reviewed);
      save.disabled = busy || !dirty || !confirm.checked || !reviewed || reviewed !== JSON.stringify(draft());
      save.textContent = busy ? 'Saving...' : 'Save changes';
    }
    function update() {
      reviewed = null;
      confirm.checked = false;
      render();
      if (!saved) return;
      const count = changes().length;
      status.textContent = (saved.saved_at ? 'Saved ' + new Date(saved.saved_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT.' : 'Using application defaults.') + ' ' + (count ? count + ' unsaved change' + (count === 1 ? '.' : 's.') : 'No unsaved changes.');
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
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message || 'Unable to load or save settings.');
      return payload.data;
    }
    async function load() {
      if (busy) return;
      busy = true;
      update();
      status.textContent = 'Loading settings...';
      try {
        saved = await request({ headers: { Accept: 'application/json' } });
        restore();
      } catch (error) {
        status.textContent = error.message + (saved ? ' Your changes are kept. Use Reload to retry.' : ' Use Reload to retry.');
        showToast(error.message, 'error');
      } finally { busy = false; render(); }
    }
    form.addEventListener('change', function (event) {
      if (event.target === confirm) {
        render();
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
    reviewButton.addEventListener('click', function () {
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
      render();
      review.focus({ preventScroll: true });
      review.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy || !saved || !changes().length || !confirm.checked || !reviewed || reviewed !== JSON.stringify(draft())) return;
      const settings = draft();
      busy = true;
      render();
      status.textContent = 'Saving changes...';
      try {
        const token = await getCsrfToken(true);
        if (!token) throw new Error('Unable to verify your session. Try again.');
        saved = await request({ method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ settings, version: saved.version, confirmed: true }) });
        restore();
        showToast('Settings saved.', 'success');
      } catch (error) {
        update();
        status.textContent = error.message + ' Your changes are kept.';
        showToast(error.message, 'error');
      } finally { busy = false; render(); }
    });
    window.addEventListener('beforeunload', function (event) {
      if (saved && changes().length) { event.preventDefault(); event.returnValue = ''; }
    });
    load();
  };
}());
