/* Shared authenticated address API; address details are never cached locally. */
window.CCAddresses = (() => {
  async function request(body) {
    const options = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body) {
      const csrfResponse = await fetch('public/api/auth/csrf.php', options);
      const csrf = await csrfResponse.json();
      if (!csrfResponse.ok || !csrf.success) throw new Error('Unable to verify your session. Please retry.');
      options.method = 'POST';
      options.headers = { ...options.headers, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.data.token };
      options.body = JSON.stringify(body);
    }
    const response = await fetch('public/api/auth/addresses.php', options);
    const result = await response.json();
    if (!response.ok || !result.success) {
      const error = new Error(result.error?.message || 'Unable to load your addresses.');
      error.fields = result.error?.fields || {};
      error.status = response.status;
      throw error;
    }
    return result.data;
  }
  const defaultShipping = addresses => addresses.find(a => Number(a.is_default_shipping) === 1) || addresses[0];
  const lines = a => [
    `${a.first_name} ${a.last_name}`, a.mobile,
    [a.street_address, a.apartment].filter(Boolean).join(', '),
    [a.barangay, a.city].filter(Boolean).join(', '),
    [a.province, a.postal_code].filter(Boolean).join(' '), a.country
  ];
  return { request, defaultShipping, lines };
})();
