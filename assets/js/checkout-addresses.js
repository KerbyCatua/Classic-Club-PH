window.CCCheckoutAddresses = {
  async init(user) {
    if (!user) return;
    const panel = document.getElementById('checkout-address-book');
    const select = document.getElementById('checkout-saved-address');
    const save = document.getElementById('checkout-save-address');
    const status = document.getElementById('checkout-address-status');
    const fields = {
      first_name: 'fname', last_name: 'lname', mobile: 'mobile', country: 'country', region: 'region',
      street_address: 'street', apartment: 'apt', barangay: 'brgy', city: 'city',
      province: 'province', postal_code: 'postal', instructions: 'instructions'
    };
    let addresses = [], dirty = false;
    const input = name => document.getElementById('checkout-' + fields[name]);
    for (const name of Object.keys(fields)) input(name).addEventListener('input', () => { dirty = true; });
    panel.hidden = false;
    function message(text, error = false) {
      status.textContent = text;
      status.classList.toggle('text-danger', error);
    }
    function options(selected) {
      select.replaceChildren(new Option('New address', ''));
      for (const address of addresses) {
        select.add(new Option(`${address.label || 'Address'} — ${address.street_address}, ${address.city}${Number(address.is_default_shipping) ? ' (default shipping)' : ''}`, address.id));
      }
      select.value = selected ? String(selected.id) : '';
    }
    function fill(address) {
      if (!address) return;
      for (const name of Object.keys(fields)) {
        const field = input(name);
        if (field.tagName === 'SELECT' && !Array.from(field.options).some(option => option.value === address[name])) {
          field.add(new Option(address[name], address[name]));
        }
        field.value = address[name] || '';
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      dirty = false;
    }
    select.addEventListener('change', () => {
      const address = addresses.find(a => String(a.id) === select.value);
      if (address) fill(address);
      else {
        for (const name of Object.keys(fields)) {
          if (['first_name', 'last_name', 'mobile', 'country'].includes(name)) continue;
          input(name).value = '';
          input(name).dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      message('');
    });
    save.addEventListener('click', async () => {
      const address = addresses.find(a => String(a.id) === select.value);
      const body = { action: 'save', label: address?.label || '',
        is_default_shipping: address ? Boolean(Number(address.is_default_shipping)) : !addresses.length,
        is_default_billing: address ? Boolean(Number(address.is_default_billing)) : !addresses.length };
      if (address) body.id = Number(address.id);
      for (const name of Object.keys(fields)) body[name] = input(name).value;
      save.disabled = select.disabled = true;
      message('Saving address…');
      try {
        const result = await CCAddresses.request(body);
        addresses = result.addresses;
        options(addresses.find(a => Number(a.id) === Number(result.id)));
        message('Address saved to your account. These details will also be used for this order.');
      } catch (error) {
        message([error.message, ...Object.values(error.fields || {})].join(' '), true);
        const name = Object.keys(error.fields || {}).find(key => fields[key]);
        if (name) input(name).focus();
      } finally { save.disabled = select.disabled = false; }
    });
    message('Loading saved addresses…');
    try {
      addresses = (await CCAddresses.request()).addresses;
      const address = CCAddresses.defaultShipping(addresses);
      options(dirty ? null : address);
      if (!dirty) fill(address);
      message(address ? 'Edit the delivery fields below. Use Save address to keep changes in your account.' : 'Enter your delivery details below. Use Save address to add them to your account.');
      save.disabled = select.disabled = false;
    } catch (error) {
      message(error.message + ' You can still enter delivery details for this order.', true);
    }
  }
};
