/* Shared checkout and address-book validation. No payment details are collected. */
window.CCCheckoutValidation = (() => {
  'use strict';

  const form = document.getElementById('checkout-form');
  const summary = document.getElementById('checkout-errors');
  const errorList = document.getElementById('checkout-error-list');
  const title = document.getElementById('checkout-errors-title');
  const announcement = document.getElementById('checkout-validation-status');
  const fields = [...form.querySelectorAll('input[name], select[name], textarea[name]')]
    .filter(field => field.name !== 'saved_address');
  const errors = new Map();
  const touched = new Set();
  let submitted = false;
  const labels = {
    email: 'Email address', first_name: 'First name', last_name: 'Last name', mobile: 'Mobile number',
    country: 'Country / region', region: 'Region', street_address: 'Street address',
    apartment: 'Building, unit or floor', instructions: 'Delivery instructions', barangay: 'Barangay',
    city: 'City / municipality', province: 'Province / Metro Manila', postal_code: 'Postal code',
    delivery_method: 'Delivery', payment_method: 'Demo payment method', demo_consent: 'Demo acknowledgment'
  };

  function normalize(field) {
    if (['radio', 'checkbox'].includes(field.type)) return;
    let value = field.value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\ufeff\u202a-\u202e\u2066-\u2069]/g, '');
    value = field.tagName === 'TEXTAREA'
      ? value.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim()
      : value.replace(/\s+/g, ' ').trim();
    if (field.name === 'email') {
      const at = value.lastIndexOf('@');
      if (at >= 0) value = value.slice(0, at + 1) + value.slice(at + 1).toLowerCase();
    }
    if (field.name === 'mobile') {
      const compact = value.replace(/[\s().-]/g, '');
      if (/^09\d{9}$/.test(compact)) value = '+63' + compact.slice(1);
      else if (/^9\d{9}$/.test(compact)) value = '+63' + compact;
      else if (/^\+?639\d{9}$/.test(compact)) value = '+' + compact.replace(/^\+/, '');
    }
    field.value = value;
  }

  function message(field) {
    const name = field.name;
    if (field.type === 'radio') {
      const selected = form.querySelector(`input[name="${name}"]:checked`);
      const allowed = name === 'payment_method' ? ['demo-card', 'demo-gcash', 'demo-maya'] : ['standard'];
      return selected && allowed.includes(selected.value) ? '' : `Choose a ${name === 'payment_method' ? 'demo payment' : 'delivery'} method.`;
    }
    if (field.type === 'checkbox') return field.checked ? '' : 'Confirm that you understand this is a demo order and have reviewed the policy.';
    const value = field.value;
    if (!value && field.required) return `Enter ${['email', 'mobile'].includes(name) ? 'your ' : ''}${labels[name].toLowerCase()}.`;
    if (!value) return '';
    if (field.maxLength > 0 && [...value].length > field.maxLength) return `Use ${field.maxLength} characters or fewer.`;
    if (/[<>]/.test(value)) return 'Use plain text without < or > characters.';
    if (name === 'email' && (field.validity.typeMismatch || !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
      || value.split('@')[0].length > 64 || /^\.|\.$|\.\./.test(value.split('@')[0]))) return 'Enter a valid email address, such as you@example.com.';
    if (['first_name', 'last_name'].includes(name) && (!/\p{L}/u.test(value) || !/^[\p{L}\p{M} .,'’ʼ\-\u2010-\u2015·]+$/u.test(value))) return 'Use letters, spaces, apostrophes, periods or hyphens for this name.';
    if (name === 'mobile' && !/^\+639\d{9}$/.test(value)) return 'Enter a Philippine mobile number, such as 0917 123 4567 or +63 917 123 4567.';
    if (name === 'postal_code' && !/^\d{4}$/.test(value)) return 'Enter a four-digit Philippine postal code, such as 1210.';
    if (name === 'country' && value !== 'Philippines') return 'Select Philippines; international delivery is unavailable in this demo.';
    if (!['email', 'mobile', 'postal_code', 'country', 'instructions', 'apartment'].includes(name) && !/[\p{L}\p{N}]/u.test(value)) return 'Enter an address detail containing letters or numbers.';
    return '';
  }

  function group(field) {
    return fields.filter(other => other.name === field.name);
  }

  function setError(field, text) {
    const id = `${group(field)[0].id}-error`;
    let error = document.getElementById(id);
    if (!error) {
      error = document.createElement('p');
      error.id = id;
      error.className = 'cc-checkout-field-error m-0';
      const container = field.name === 'payment_method' ? document.getElementById('payment-method-group').parentElement
        : field.name === 'delivery_method' ? document.getElementById('checkout-delivery-group')
        : field.closest('.d-flex.flex-column') || field.parentElement;
      container.append(error);
    }
    error.textContent = text;
    error.hidden = !text;
    for (const member of group(field)) {
      const described = new Set((member.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      if (text) described.add(id);
      else described.delete(id);
      if (described.size) member.setAttribute('aria-describedby', [...described].join(' '));
      else member.removeAttribute('aria-describedby');
      member.setAttribute('aria-invalid', text ? 'true' : 'false');
      member.setCustomValidity(text);
    }
    if (text) errors.set(field.name, { field: group(field)[0], text });
    else errors.delete(field.name);
  }

  function renderSummary(general = '') {
    if (!submitted && !general) return;
    // Keep existing links mounted so a field's blur cannot swallow a summary click.
    for (const item of [...errorList.children]) {
      if (!errors.has(item.dataset.field)) item.remove();
    }
    for (const { field, text } of errors.values()) {
      let li = errorList.querySelector(`[data-field="${field.name}"]`);
      if (!li) {
        li = document.createElement('li');
        li.dataset.field = field.name;
        const link = document.createElement('a');
        link.href = '#' + field.id;
        link.addEventListener('click', event => { event.preventDefault(); field.focus(); });
        li.append(link);
        errorList.append(li);
      }
      const link = li.firstElementChild;
      link.textContent = `${labels[field.name]}: ${text}`;
    }
    title.textContent = general || `Please correct ${errors.size === 1 ? 'the highlighted field' : `these ${errors.size} fields`} before continuing.`;
    summary.hidden = !general && errors.size === 0;
  }

  function validate(candidates = fields) {
    const unique = [...new Map(candidates.map(field => [field.name, field])).values()];
    for (const field of unique) {
      normalize(field);
      touched.add(field.name);
      setError(field, message(field));
    }
    submitted = true;
    renderSummary();
    const firstInvalid = unique.find(field => errors.has(field.name));
    if (firstInvalid) firstInvalid.focus();
    form.dispatchEvent(new CustomEvent('cc:checkoutNormalized'));
    return !firstInvalid;
  }

  for (const field of fields) {
    field.addEventListener('blur', () => {
      normalize(field);
      touched.add(field.name);
      const text = message(field);
      setError(field, text);
      announcement.textContent = text ? `${labels[field.name]}: ${text}` : '';
      renderSummary();
      form.dispatchEvent(new CustomEvent('cc:checkoutNormalized'));
    });
    field.addEventListener('input', () => {
      field.dataset.edited = 'true';
      // Let people finish typing; clear old errors as soon as a correction is valid.
      if (touched.has(field.name)) {
        if (!message(field)) setError(field, '');
        renderSummary();
      }
    });
    field.addEventListener('change', () => {
      if (['radio', 'checkbox', 'select-one'].includes(field.type)) {
        touched.add(field.name);
        setError(field, message(field));
        renderSummary();
      }
    });
  }

  return {
    validate,
    validateShipping: () => validate(fields.filter(field => field.closest('#checkout-shipping'))),
    showServerErrors(serverFields = {}, general = '') {
      submitted = true;
      for (const [name, text] of Object.entries(serverFields)) {
        const field = fields.find(item => item.name === name);
        if (field) { touched.add(name); setError(field, String(text)); }
      }
      renderSummary(general);
      summary.focus();
    },
    resetShipping() {
      for (const field of fields.filter(field => field.closest('#checkout-shipping'))) {
        touched.delete(field.name);
        setError(field, '');
      }
      renderSummary();
    },
    clearSummary() { summary.hidden = true; }
  };
})();
