document.addEventListener('DOMContentLoaded', () => {
  const modalEl = document.getElementById('manage-address-modal');
  const form = document.getElementById('address-form');
  const list = document.getElementById('address-book');
  const status = document.getElementById('address-status');
  const save = document.getElementById('address-save');
  const add = document.getElementById('address-add');
  let addresses = [], selectedId = null, busy = false, loaded = false;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('text-danger', error);
    status.setAttribute('role', error ? 'alert' : 'status');
  }
  function clearErrors() {
    form.querySelectorAll('.is-invalid').forEach(el => { el.classList.remove('is-invalid'); el.removeAttribute('aria-invalid'); });
    form.querySelectorAll('.invalid-feedback').forEach(el => el.remove());
  }
  function edit(address) {
    selectedId = address ? Number(address.id) : null;
    form.reset();
    clearErrors();
    for (const field of form.elements) {
      if (!field.name || !address) continue;
      if (field.type === 'checkbox') field.checked = Number(address[field.name]) === 1;
      else field.value = address[field.name] || '';
    }
    if (!address && !addresses.length) {
      form.elements.is_default_shipping.checked = true;
      form.elements.is_default_billing.checked = true;
    }
    document.getElementById('address-editor-title').textContent = address ? 'Edit address' : 'Add new address';
    render();
  }
  function dashboard() {
    const el = document.getElementById('dashboard-shipping-address');
    const address = CCAddresses.defaultShipping(addresses);
    el.textContent = address ? CCAddresses.lines(address).join('\n') : 'No saved address.';
    el.classList.add('cc-address-lines');
  }
  function render() {
    list.replaceChildren();
    if (!addresses.length) {
      const empty = document.createElement('p');
      empty.className = 'cc-xs-text';
      empty.textContent = 'No saved addresses. Add your first delivery address.';
      list.append(empty);
    }
    for (const address of addresses) {
      const card = document.createElement('article');
      card.className = 'cc-address-card d-flex flex-column gap-3' + (Number(address.id) === selectedId ? ' is-selected' : '');
      const title = document.createElement('h4');
      title.className = 'font-lora m-0 fs-4';
      title.textContent = address.label || 'Address';
      const defaults = document.createElement('span');
      defaults.className = 'cc-eyebrow';
      defaults.textContent = [Number(address.is_default_shipping) ? 'DEFAULT SHIPPING' : '', Number(address.is_default_billing) ? 'DEFAULT BILLING' : ''].filter(Boolean).join(' · ');
      const details = document.createElement('p');
      details.className = 'cc-xs-text cc-address-lines m-0';
      details.textContent = CCAddresses.lines(address).join('\n');
      const actions = document.createElement('div');
      actions.className = 'd-flex gap-3';
      for (const [label, handler] of [
        ['Edit address', () => { edit(address); message(''); CCSnackbar.show('Address selected.'); form.elements.first_name.focus(); }],
        ['Remove', async () => {
          if (!confirm('Remove this saved address? Past orders will keep their delivery details.')) return;
          await mutate({ action: 'delete', id: Number(address.id) }, 'Address removed.');
        }]
      ]) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label; button.disabled = busy;
        button.addEventListener('click', handler); actions.append(button);
      }
      card.append(title, defaults, details, actions); list.append(card);
    }
  }
  function setBusy(value) {
    busy = value;
    save.disabled = add.disabled = value || !loaded;
    form.querySelector('fieldset').disabled = value || !loaded;
    render();
  }
  async function load() {
    setBusy(true);
    message('Loading your addresses…');
    try {
      addresses = (await CCAddresses.request()).addresses;
      loaded = true;
      edit(CCAddresses.defaultShipping(addresses)); dashboard(); message('');
    } catch (error) { message(error.message, true); }
    finally { setBusy(false); }
  }
  async function mutate(body, success) {
    if (busy) return;
    clearErrors(); setBusy(true); message('Saving changes…');
    try {
      const result = await CCAddresses.request(body);
      addresses = result.addresses;
      edit(addresses.find(a => Number(a.id) === Number(result.id)) || CCAddresses.defaultShipping(addresses));
      dashboard(); message(success);
      if (body.action === 'save') CCSnackbar.show(success);
    } catch (error) {
      message(error.message, true);
      for (const [name, text] of Object.entries(error.fields || {})) {
        const field = form.elements.namedItem(name);
        if (!field) continue;
        field.classList.add('is-invalid'); field.setAttribute('aria-invalid', 'true');
        const feedback = document.createElement('div');
        feedback.className = 'invalid-feedback'; feedback.textContent = text;
        field.after(feedback);
      }
    } finally {
      setBusy(false);
      if (modalEl.classList.contains('show')) (form.querySelector('.is-invalid') || save).focus();
    }
  }
  document.getElementById('manage-addresses-link').addEventListener('click', e => { e.preventDefault(); modal.show(); });
  modalEl.addEventListener('show.bs.modal', () => {
    document.body.classList.add('cc-address-modal-open');
    // Bootstrap creates the backdrop after the show event.
    requestAnimationFrame(() => document.querySelector('.modal-backdrop:last-of-type')?.classList.add('cc-address-backdrop'));
    load();
  });
  modalEl.addEventListener('hide.bs.modal', e => { if (busy) e.preventDefault(); });
  modalEl.addEventListener('hidden.bs.modal', () => document.body.classList.remove('cc-address-modal-open'));
  add.addEventListener('click', () => { edit(); message(''); form.elements.first_name.focus(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    body.action = 'save';
    if (selectedId) body.id = selectedId;
    body.is_default_shipping = form.elements.is_default_shipping.checked;
    body.is_default_billing = form.elements.is_default_billing.checked;
    await mutate(body, 'Address saved. Your checkout details are ready.');
  });
  load();
});
