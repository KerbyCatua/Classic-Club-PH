(function () {
  'use strict';

  const overlay = document.getElementById('cc-maintenance-overlay');
  const form = document.getElementById('cc-maintenance-login');
  if (!overlay || !form) return;

  document.body.style.overflow = 'hidden';
  Array.from(document.body.children).forEach(child => {
    if (child !== overlay) child.inert = true;
  });

  // Reuse Bootstrap's focus trap and collapse animation in the existing modal.
  const modal = bootstrap.Modal.getOrCreateInstance(overlay, { backdrop: false, keyboard: false });
  modal.show();
  const toggle = document.getElementById('cc-maintenance-toggle');
  const panel = document.getElementById('cc-maintenance-admin');
  toggle.focus();
  // Keep Tab inside the dialog even when all background content is inert.
  overlay.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(overlay.querySelectorAll('button, input'))
      .filter(control => !control.disabled && control.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  panel.addEventListener('shown.bs.collapse', () => modal.handleUpdate());
  panel.addEventListener('hide.bs.collapse', () => {
    if (panel.contains(document.activeElement)) toggle.focus();
  });
  panel.addEventListener('hidden.bs.collapse', () => modal.handleUpdate());

  const feedback = document.getElementById('cc-maintenance-feedback');
  const button = form.querySelector('button[type="submit"]');

  async function csrf() {
    const response = await fetch('public/api/auth/csrf.php', {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.data?.token) {
      throw new Error('Unable to start a secure sign in. Please retry.');
    }
    return result.data.token;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    feedback.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in...';
    try {
      const token = await csrf();
      const response = await fetch('public/api/auth/login.php', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({
          email: document.getElementById('cc-maintenance-email').value.trim(),
          password: document.getElementById('cc-maintenance-password').value,
          context: 'maintenance'
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error?.message || 'Sign in failed. Please retry.');
      // The backend enforces this role before login; also guard the redirect.
      if (!result.data?.user?.roles?.includes('super_admin')) {
        const logoutToken = await csrf();
        await fetch('public/api/auth/logout.php', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { Accept: 'application/json', 'X-CSRF-Token': logoutToken }
        });
        throw new Error('Access denied. Only Super Admin accounts can manage maintenance.');
      }
      window.location.replace('super-admin-dashboard.html');
    } catch (failure) {
      feedback.textContent = failure.message || 'Sign in failed. Please retry.';
      feedback.hidden = false;
      document.getElementById('cc-maintenance-password').value = '';
      button.disabled = false;
      button.textContent = 'Sign In';
    }
  });
})();
