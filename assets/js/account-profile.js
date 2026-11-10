document.addEventListener('DOMContentLoaded', () => {
  const main = document.getElementById('account-main');
  const loadStatus = document.getElementById('account-load-status');
  const retry = document.getElementById('retry-profile-btn');
  const profileForm = document.getElementById('profile-info-form');
  const passwordForm = document.getElementById('password-security-form');
  const newsletter = document.getElementById('newsletter-check');
  const emailPassword = document.getElementById('email-current-password');
  let savedEmail = '';
  let saving = false;

  async function request(url, body) {
    const options = { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      const csrf = await request('public/api/auth/csrf.php');
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.headers['X-CSRF-Token'] = csrf.token;
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('The server is unavailable. Please try again.'); }
    if (response.status === 401) {
      window.location.replace('auth.html?notice=login');
      throw new Error('Your session expired. Please sign in again.');
    }
    if (!response.ok || !result.success) {
      const error = new Error(result.error?.message || 'Unable to save changes. Please try again.');
      error.fields = result.error?.fields || {};
      throw error;
    }
    return result.data;
  }

  function syncCheckbox() {
    const box = newsletter.nextElementSibling;
    box.style.background = newsletter.checked ? 'var(--cc-accent)' : 'var(--cc-bg)';
    box.style.borderColor = newsletter.checked ? 'var(--cc-accent)' : 'var(--cc-border)';
    box.textContent = newsletter.checked ? '✓' : '';
  }

  function syncEmailConfirmation() {
    const changed = profileForm.elements.email.value.trim().toLowerCase() !== savedEmail;
    const block = document.getElementById('email-confirmation');
    // Bootstrap's d-flex utility overrides the browser's hidden styling.
    block.classList.toggle('d-flex', changed);
    block.hidden = !changed;
    emailPassword.required = changed;
    if (!changed) emailPassword.value = '';
  }

  function populate(data) {
    const user = data.user;
    savedEmail = user.email;
    for (const field of ['first_name', 'last_name', 'email', 'mobile']) profileForm.elements[field].value = user[field] || '';
    const snapshots = { '.customer-fname': user.first_name, '.customer-lname': user.last_name, '.customer-email': user.email,
      '.customer-initials': (user.first_name.charAt(0) + user.last_name.charAt(0)).toUpperCase() || '—' };
    Object.entries(snapshots).forEach(([selector, value]) => document.querySelectorAll(selector).forEach(el => { el.textContent = value; }));
    newsletter.checked = data.newsletter;
    syncCheckbox();
    syncEmailConfirmation();
    document.getElementById('password-minimum').textContent = data.password_policy.minimum;
    passwordForm.elements.new_password.minLength = data.password_policy.minimum;
  }

  function clearErrors(form) {
    form.querySelectorAll('.is-invalid').forEach(el => { el.classList.remove('is-invalid'); el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
    form.querySelectorAll('.profile-field-error').forEach(el => el.remove());
  }

  function showStatus(id, message, failed = false) {
    const status = document.getElementById(id);
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle('text-danger', failed);
    status.classList.toggle('text-light-cc', !failed);
    status.setAttribute('role', failed ? 'alert' : 'status');
  }

  function showError(form, statusId, error) {
    showStatus(statusId, error.message || 'Unable to reach the server. Please try again.', true);
    let first;
    Object.entries(error.fields || {}).forEach(([name, message]) => {
      const input = form.elements[name];
      if (!input) return;
      const feedback = document.createElement('span');
      feedback.id = input.id + '-error';
      feedback.className = 'profile-field-error cc-xs-text text-danger';
      feedback.textContent = message;
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', feedback.id);
      input.insertAdjacentElement('afterend', feedback);
      first ||= input;
    });
    first?.focus();
  }

  async function submit(form, button, statusId, body) {
    if (saving) return;
    saving = true;
    clearErrors(form);
    const original = button.innerHTML;
    const controls = [...profileForm.elements, ...passwordForm.elements, document.getElementById('save-profile-btn'), document.getElementById('sign-out-btn')];
    const previous = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    button.innerHTML = '<span>Saving…</span>';
    form.setAttribute('aria-busy', 'true');
    showStatus(statusId, 'Saving…');
    let error;
    try {
      const data = await request('public/api/auth/profile.php', body);
      if (body.action === 'update_profile') {
        populate(data);
        emailPassword.value = '';
      } else {
        passwordForm.reset();
      }
      showStatus(statusId, body.action === 'update_profile' ? 'Your details and preferences have been saved.' : 'Your password has been updated.');
      button.innerHTML = '<span>' + (body.action === 'update_profile' ? 'Changes saved' : 'Password updated') + ' ✓</span>';
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (failure) {
      error = failure;
    } finally {
      controls.forEach((control, index) => { control.disabled = previous[index]; });
      button.innerHTML = original;
      form.removeAttribute('aria-busy');
      saving = false;
    }
    if (error) showError(form, statusId, error);
  }

  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(profileForm));
    body.action = 'update_profile';
    body.newsletter = newsletter.checked;
    submit(profileForm, document.getElementById('save-profile-btn'), 'profile-status', body);
  });
  passwordForm.addEventListener('submit', event => {
    event.preventDefault();
    submit(passwordForm, document.getElementById('update-password-btn'), 'password-status', { ...Object.fromEntries(new FormData(passwordForm)), action: 'update_password' });
  });
  profileForm.elements.email.addEventListener('input', syncEmailConfirmation);
  newsletter.addEventListener('change', syncCheckbox);
  newsletter.addEventListener('focus', () => { newsletter.nextElementSibling.style.outline = '2px solid var(--cc-accent)'; });
  newsletter.addEventListener('blur', () => { newsletter.nextElementSibling.style.outline = ''; });

  document.getElementById('sign-out-btn').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await request('public/api/auth/logout.php', {});
      if (typeof CCStore !== 'undefined') CCStore.clearAllUserData();
      window.location.replace('auth.html');
    } catch (error) {
      button.disabled = false;
      showStatus('profile-status', error.message, true);
    }
  });

  const wishlistCount = () => {
    if (typeof CCStore !== 'undefined') document.getElementById('wishlist-sidebar-count').textContent = CCStore.getWishlist().length;
  };
  window.addEventListener('cc:wishlistUpdated', wishlistCount);
  wishlistCount();

  async function load() {
    retry.hidden = true;
    retry.disabled = true;
    try {
      populate(await request('public/api/auth/profile.php'));
      main.hidden = false;
      loadStatus.hidden = true;
    } catch (error) {
      loadStatus.firstChild.textContent = (error.message || 'Unable to load your account.') + ' ';
      retry.hidden = false;
    } finally { retry.disabled = false; }
  }
  retry.addEventListener('click', load);
  load();
});
