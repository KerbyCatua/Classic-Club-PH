(function () {
  'use strict';
  window.initSupportTickets = function ({ byId, escapeHtml: esc, showToast, getCsrfToken, refreshOverview }) {
    const root = byId('module-tickets');
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const statuses = [['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['closed', 'Closed']];
    const priorities = ['Critical', 'High', 'Medium', 'Low'];
    let categories = [], agents = [], selected = null, page = 1, pages = 1, entryPage = 1;
    let busy = false, listLoading = false, detailLoading = false, listReady = false, metadataReady = false, conflict = false;
    let listSeq = 0, detailSeq = 0, timer, createBaseline = '';
    const options = (items, blank) => (blank === undefined ? '' : '<option value="">' + esc(blank) + '</option>') + items.map(x => '<option value="' + esc(Array.isArray(x) ? x[0] : x) + '">' + esc(Array.isArray(x) ? x[1] : x) + '</option>').join('');
    const select = (name, label, items, blank) => '<label class="d-flex flex-column gap-1 text-muted-cc">' + label + '<select name="' + name + '" class="admin-select-filter w-100">' + options(items, blank) + '</select></label>';
    const input = (name, label, max, type = 'text', required = true) => '<label class="d-flex flex-column gap-1 text-muted-cc">' + label + '<input class="admin-input-filter w-100" name="' + name + '" type="' + type + '" maxlength="' + max + '" ' + (required ? 'required' : '') + '></label>';
    const textarea = (name, label, required = true) => '<label class="d-flex flex-column gap-1 text-muted-cc">' + label + '<textarea class="admin-input-filter w-100" name="' + name + '" rows="3" maxlength="10000" ' + (required ? 'required' : '') + '></textarea></label>';
    const button = (label, action) => '<button type="button" class="btn-admin-outline" data-action="' + action + '">' + label + '</button>';
    const col = (html, width = 6) => '<div class="col-md-' + width + '">' + html + '</div>';
    const statusLabel = value => statuses.find(s => s[0] === value)?.[1] || value;
    const badge = (value, status = false) => {
      const variant = status ? ({ open: 'info', in_progress: 'warning', resolved: 'success', closed: 'neutral' }[value]) : ({ Critical: 'danger', High: 'danger', Medium: 'warning', Low: 'neutral' }[value]);
      return '<span class="sa-badge sa-badge-' + (variant || 'neutral') + '">' + esc(status ? statusLabel(value) : value) + '</span>';
    };
    // Include disabled fields so in-flight saves do not hide unsaved editor values.
    const values = form => Object.fromEntries(Array.from(form.elements).filter(el => el.name && el.type !== 'file').map(el => [el.name, el.value]));
    const agentOptions = () => agents.map(a => [String(a.id), a.name]);
    root.innerHTML = '<div class="d-flex justify-content-between align-items-start mb-2"><span class="admin-section-eyebrow">06 / SUPPORT</span>' +
      '<a href="#module-directory" class="text-muted-cc cc-underline-link admin-directory-return">Directory ↑</a></div>' +
      '<div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3"><div><h2 class="admin-section-title mb-2">Support tickets</h2><p class="admin-section-desc mb-0">Review requests, assign support and follow up.</p></div><div id="supportStats" class="d-flex flex-wrap gap-3 text-muted-cc" role="status"></div></div>' +
      '<details id="supportCreatePanel" class="admin-card mb-4"><summary class="text-light-cc">Create ticket</summary><form id="supportCreate" class="mt-3"><fieldset class="d-flex flex-column gap-3" disabled>' +
      '<div class="row g-3">' + col(input('full_name', 'Requester name', 160)) + col(input('email', 'Requester email', 190, 'email')) + col(input('subject', 'Subject', 200), 12) +
      col(select('category', 'Category', []), 4) + col(select('priority', 'Priority', priorities), 4) + col(select('assigned_to', 'Assigned to', [], 'Unassigned'), 4) + '</div>' +
      input('order_number', 'Order number (optional)', 30, 'text', false) + textarea('message', 'Request') + '<div><button class="btn-admin-primary" type="submit">Create ticket</button></div></fieldset></form></details>' +
      '<form id="supportFilters" class="row g-3 align-items-end mb-3">' + col(input('search', 'Search tickets', 200, 'search', false), 8) +
      col(select('status', 'Status', statuses, 'All statuses'), 4) + col(select('priority', 'Priority', priorities, 'All priorities'), 4) +
      col(select('category', 'Category', [], 'All categories'), 4) + col(select('assigned_to', 'Assigned to', [], 'All agents'), 4) +
      '<div class="col-12 d-flex flex-wrap gap-2"><button type="submit" class="btn-admin-outline">Search</button>' + button('Clear filters', 'clear') + button('Refresh', 'refresh') + '</div></form>' +
      '<p id="supportError" role="alert" class="text-danger" hidden></p><div class="admin-table-container" tabindex="0" role="region" aria-label="Support tickets"><table class="admin-table"><thead><tr><th scope="col">Ticket / requester</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Assigned to</th><th scope="col">Updated · PHT</th><th scope="col">Action</th></tr></thead><tbody id="supportRows"><tr><td colspan="6">Loading tickets…</td></tr></tbody></table></div>' +
      '<nav class="d-flex flex-wrap gap-3 align-items-center my-3" aria-label="Ticket pages">' + button('Previous', 'previous') + '<span id="supportPage" class="text-muted-cc" role="status"></span>' + button('Next', 'next') + '</nav>' +
      '<p id="supportDetailMessage" class="text-danger" role="alert" hidden></p><div id="supportDetail" class="admin-card mt-4" hidden></div>';
    const createForm = byId('supportCreate'), filters = byId('supportFilters');
    createForm.elements.priority.value = 'Medium';
    filters.elements.search.placeholder = 'ID, subject, requester, email or request';
    function message(id, text = '') { byId(id).textContent = text; byId(id).hidden = !text; }
    async function api(params, body, file) {
      const headers = { Accept: 'application/json' };
      const init = { credentials: 'same-origin', cache: 'no-store', headers };
      if (body) {
        init.method = 'POST'; headers['X-CSRF-Token'] = await getCsrfToken();
        if (file) {
          const form = new FormData(); Object.entries(body).forEach(([key, value]) => form.append(key, value == null ? '' : value));
          form.append('attachment', file); init.body = form;
        } else { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      }
      const response = await fetch('public/api/super-admin/tickets.php' + (params ? '?' + new URLSearchParams(params) : ''), init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        const error = new Error(payload.error?.message || 'Unable to access support tickets. Please retry.'); error.status = response.status; throw error;
      }
      return payload.data;
    }
    function metadata(data) {
      if (metadataReady && JSON.stringify([categories, agents]) === JSON.stringify([data.categories, data.agents])) return;
      const pristine = !metadataReady || JSON.stringify(values(createForm)) === createBaseline;
      categories = data.categories; agents = data.agents;
      [createForm, filters].forEach(form => {
        [['category', categories, form === filters ? 'All categories' : undefined], ['assigned_to', form === filters ? [['unassigned', 'Unassigned'], ...agentOptions()] : agentOptions(), form === filters ? 'All agents' : 'Unassigned']].forEach(([name, items, blank]) => {
          const control = form.elements[name], value = control.value;
          control.innerHTML = options(items, blank);
          if (Array.from(control.options).some(option => option.value === value)) control.value = value;
        });
      });
      metadataReady = true;
      if (pristine) createBaseline = JSON.stringify(values(createForm));
    }
    function lock() {
      root.querySelectorAll('button').forEach(b => {
        b.disabled = busy || detailLoading || (conflict && !!b.closest('#supportDetail form'));
        if (b.dataset.ticket) b.disabled ||= listLoading || !listReady;
      });
      root.querySelectorAll('fieldset').forEach(fieldset => { fieldset.disabled = busy || detailLoading || (fieldset.form === createForm && !metadataReady); });
      root.querySelector('[data-action="previous"]').disabled = busy || detailLoading || listLoading || !listReady || page <= 1;
      root.querySelector('[data-action="next"]').disabled = busy || detailLoading || listLoading || !listReady || page >= pages;
      byId('supportRows').closest('[role="region"]').setAttribute('aria-busy', String(listLoading));
      byId('supportDetail').setAttribute('aria-busy', String(busy || detailLoading));
    }
    async function loadList() {
      clearTimeout(timer);
      const seq = ++listSeq;
      listLoading = true; lock(); byId('supportPage').textContent = 'Loading tickets…';
      try {
        const data = await api({ ...values(filters), page });
        if (seq !== listSeq) return;
        metadata(data); page = data.page; pages = data.pages; listReady = true;
        message('supportError');
        byId('supportRows').innerHTML = data.rows.map(t => '<tr><td><strong>INQ-' + esc(t.id) + '</strong><div class="support-subject">' + esc(t.subject) + '</div><small class="text-muted-cc">' + esc(t.full_name) + '</small></td><td data-label="Priority">' + badge(t.priority) + '</td><td data-label="Status">' + badge(t.status, true) + '</td><td data-label="Assigned to">' + esc(t.assignee || 'Unassigned') + '</td><td data-label="Updated · PHT">' + esc(t.updated_at) + '</td><td><button type="button" class="btn-admin-outline btn-admin-sm" data-ticket="' + esc(t.id) + '" aria-label="Open ticket INQ-' + esc(t.id) + '">Open</button></td></tr>').join('') || '<tr><td colspan="6">No tickets found. Try changing or clearing the filters.</td></tr>';
        byId('supportPage').textContent = data.total + (data.total === 1 ? ' ticket' : ' tickets') + ' · Page ' + page + ' of ' + pages;
        byId('supportStats').innerHTML = '<span>All tickets: <strong class="text-light-cc">' + esc(data.stats.unresolved || 0) + '</strong> unresolved</span><span><strong class="text-light-cc">' + esc(data.stats.completed || 0) + '</strong> completed</span>';
      } catch (error) {
        if (seq !== listSeq) return;
        listReady = false; message('supportError', error.message);
        byId('supportRows').innerHTML = '<tr><td colspan="6">Ticket list unavailable. Use Refresh to retry.</td></tr>';
        byId('supportPage').textContent = 'Tickets unavailable';
      } finally { if (seq === listSeq) { listLoading = false; lock(); } }
    }
    function editor() {
      return selected && byId('supportEdit') ? {
        edit: values(byId('supportEdit')), reply: byId('supportReply').elements.body.value,
        note: byId('supportNote').elements.body.value, upload: byId('supportUpload').elements.attachment,
        open: Array.from(byId('supportDetail').querySelectorAll('details[id][open]')).map(el => el.id)
      } : null;
    }
    function editDirty(state) { return state && Object.entries(state.edit).some(([key, value]) => value !== String(selected[key] ?? '')); }
    function dirty() {
      const state = editor();
      return state && (editDirty(state) || state.reply !== byId('supportReply').dataset.draft || state.note.trim() || state.upload.files.length);
    }
    function history(entry) {
      let body = '<p class="support-message mb-0">' + esc(entry.body) + '</p>';
      if (entry.kind === 'history') {
        try {
          const changes = JSON.parse(entry.body);
          const labels = { status: 'Status', priority: 'Priority', category: 'Category', subject: 'Subject', assigned_to: 'Assigned to', resolution_summary: 'Resolution' };
          const display = (key, value) => key === 'status' ? statusLabel(value) : key === 'assigned_to' ? (value ? agents.find(a => String(a.id) === String(value))?.name || 'Agent #' + value : 'Unassigned') : value || 'None';
          if (changes && Object.keys(changes).length && Object.entries(changes).every(([, change]) => change && Object.hasOwn(change, 'from') && Object.hasOwn(change, 'to'))) {
            body = '<ul class="mb-0">' + Object.entries(changes).map(([key, change]) => '<li>' + esc(labels[key] || key) + ': ' + esc(display(key, change.from)) + ' → ' + esc(display(key, change.to)) + '</li>').join('') + '</ul>';
          }
        } catch (_) { /* Legacy history is plain text. */ }
        return '<details class="sa-list-row"><summary class="text-muted-cc">Update · ' + esc(entry.author || 'Deleted user') + ' · ' + esc(entry.created_at) + '</summary>' + body + '</details>';
      }
      return '<div class="sa-list-row"><div class="text-muted-cc mb-2">' + esc(entry.kind === 'reply' ? 'Reply' : 'Internal note') + ' · ' + esc(entry.author || 'Deleted user') + ' · ' + esc(entry.created_at) + '</div>' + body + '</div>';
    }
    function resolution() {
      const form = byId('supportEdit'), summary = form.elements.resolution_summary;
      summary.required = ['resolved', 'closed'].includes(form.elements.status.value);
      summary.closest('label').hidden = !summary.required && !summary.value;
      summary.setCustomValidity(summary.required && !summary.value.trim() ? 'Add a resolution summary to resolve or close this ticket.' : '');
    }
    function renderDetail(data, action = '', preserve = true) {
      const state = selected?.id === data.ticket.id ? editor() : null;
      const edits = preserve && state && action !== 'update' ? Object.fromEntries(Object.entries(state.edit).filter(([key, value]) => value !== String(selected[key] ?? ''))) : {};
      selected = data.ticket; entryPage = data.page; conflict = false;
      const t = selected, panel = byId('supportDetail'); panel.hidden = false;
      message('supportDetailMessage');
      panel.innerHTML = '<div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3"><div><h3 id="supportDetailTitle" class="font-lora mb-2" tabindex="-1">INQ-' + esc(t.id) + ' · ' + esc(t.subject) + '</h3><div class="text-muted-cc">' + esc(t.full_name) + ' · ' + esc(t.email) + (t.order_number ? ' · Order ' + esc(t.order_number) : '') + '</div><small class="text-muted-cc">Created ' + esc(t.created_at) + ' · PHT</small></div><div class="d-flex flex-wrap gap-2">' + button('Reload ticket', 'reload') + button('Close view', 'close') + '</div></div>' +
        '<div class="row g-4"><div class="col-lg-5"><form id="supportEdit"><fieldset class="d-flex flex-column gap-3">' + input('subject', 'Subject', 200) + '<div class="row g-3">' + col(select('status', 'Status', statuses)) + col(select('priority', 'Priority', priorities)) + col(select('category', 'Category', categories), 12) + col(select('assigned_to', 'Assigned to', agentOptions(), 'Unassigned'), 12) + '</div>' + textarea('resolution_summary', 'Resolution summary', false) + '<div><button type="submit" class="btn-admin-primary">Save changes</button></div></fieldset></form>' +
        '<details id="supportAttachments" class="mt-4"><summary>Attachments (' + data.attachments.length + ')</summary>' + (data.attachments.length ? '<ul class="my-3">' + data.attachments.map(a => '<li><a class="text-accent" href="public/api/super-admin/ticket-attachment.php?id=' + esc(a.id) + '">' + esc(a.original_name) + '</a> <small class="text-muted-cc">(' + Math.ceil(a.file_size / 1024) + ' KB)</small></li>').join('') + '</ul>' : '') +
        '<form id="supportUpload" class="mt-3"><fieldset class="d-flex flex-column gap-3"><label class="d-flex flex-column gap-1 text-muted-cc">JPG, PNG or PDF · up to 5 MB<input class="admin-input-filter w-100" name="attachment" type="file" accept="image/jpeg,image/png,application/pdf" required></label><div><button class="btn-admin-outline" type="submit">Add attachment</button></div></fieldset></form></details></div>' +
        '<div class="col-lg-7"><h4 class="h6 text-light-cc">Original request</h4><p class="support-message">' + esc(t.message) + '</p><h4 class="h6 text-light-cc mt-4">Activity <small class="text-muted-cc">· newest first · PHT</small></h4>' +
        (data.entries.map(history).join('') || '<p class="text-muted-cc">No activity yet.</p>') +
        (data.pages > 1 ? '<nav class="d-flex flex-wrap align-items-center gap-2 my-3" aria-label="Activity pages">' + (data.page > 1 ? button('Newer', 'newer') : '') + '<span class="text-muted-cc">Page ' + data.page + ' of ' + data.pages + '</span>' + (data.page < data.pages ? button('Older', 'older') : '') + '</nav>' : '') +
        '<form id="supportReply" class="my-4"><fieldset class="d-flex flex-column gap-3">' + textarea('body', 'Reply', false) + '<div class="d-flex flex-wrap gap-2"><button class="btn-admin-primary" type="submit">Post reply</button>' + button('Save draft', 'draft') + '</div><small class="text-muted-cc">Replies are saved here. Linked businesses receive an in-app notification; email is not sent.</small></fieldset></form>' +
        '<details id="supportNotes"><summary>Add internal note</summary><form id="supportNote" class="mt-3"><fieldset class="d-flex flex-column gap-3">' + textarea('body', 'Visible to support administrators only') + '<div><button class="btn-admin-outline" type="submit">Add note</button></div></fieldset></form></details></div></div>';
      const form = byId('supportEdit');
      Object.keys(values(form)).forEach(key => {
        const value = Object.hasOwn(edits, key) ? edits[key] : t[key] ?? '';
        if (key === 'assigned_to' && value && !agents.some(a => String(a.id) === String(value))) form.elements[key].add(new Option((t.assignee || 'Unavailable agent') + ' (inactive)', value));
        form.elements[key].value = value;
      });
      const reply = byId('supportReply'); reply.dataset.draft = data.draft;
      reply.elements.body.value = state && !['reply', 'draft'].includes(action) ? state.reply : data.draft;
      if (state) {
        byId('supportNote').elements.body.value = action === 'note' ? '' : state.note;
        if (action !== 'attachment') byId('supportUpload').elements.attachment.replaceWith(state.upload);
        state.open.forEach(id => { byId(id).open = true; });
      }
      resolution(); lock();
    }
    async function loadDetail(id, historyPage = 1, reload = false) {
      if (busy || detailLoading) return;
      if (selected && String(id) !== String(selected.id) && dirty() && !window.confirm('Discard unsaved ticket changes? Save your reply as a draft to keep it.')) return;
      if (reload && editDirty(editor()) && !window.confirm('Reload the latest ticket and discard unsaved ticket fields? Reply and note text will be kept.')) return;
      const seq = ++detailSeq;
      detailLoading = true; lock(); message('supportDetailMessage', 'Loading ticket…');
      try {
        const data = await api({ id, page: historyPage });
        if (seq !== detailSeq) return;
        renderDetail(data, '', !reload);
        if (historyPage === 1) byId('supportDetailTitle').focus({ preventScroll: true });
        byId('supportDetail').scrollIntoView({ block: 'start' });
      } catch (error) { if (seq === detailSeq) message('supportDetailMessage', error.message); }
      finally { if (seq === detailSeq) { detailLoading = false; lock(); } }
    }
    async function write(action, fields = {}, file) {
      if (busy || detailLoading || (action !== 'create' && (!selected || conflict))) return;
      if (action === 'create' && dirty() && !window.confirm('Create this ticket and discard unsaved changes to the open ticket?')) return;
      busy = true; lock(); ++detailSeq;
      try {
        const data = await api(null, { action, ...(action !== 'create' ? { id: selected.id, version: selected.version, updated_at: selected.updated_at } : {}), ...fields }, file);
        renderDetail(data, action);
        if (action === 'create') {
          createForm.reset(); createForm.elements.priority.value = 'Medium'; createBaseline = JSON.stringify(values(createForm));
          byId('supportCreatePanel').open = false;
          byId('supportDetail').scrollIntoView({ block: 'start' }); byId('supportDetailTitle').focus({ preventScroll: true });
        }
        showToast(({ create: 'Ticket created.', update: 'Ticket updated.', reply: 'Reply posted.', draft: 'Draft saved.', note: 'Internal note added.', attachment: 'Attachment added.' })[action]);
        await loadList();
        if (refreshOverview && action !== 'draft') Promise.resolve().then(refreshOverview).catch(() => {});
      } catch (error) {
        if (error.status === 409) conflict = true;
        message(action === 'create' ? 'supportError' : 'supportDetailMessage', error.status === 409 ? 'This ticket changed. Reload ticket to review the latest version before saving. Your text has been kept.' : error.message);
      } finally { busy = false; lock(); }
    }
    root.addEventListener('submit', event => {
      event.preventDefault(); const form = event.target;
      if (busy || detailLoading) return;
      if (form === filters) { page = 1; loadList(); return; }
      Array.from(form.elements).filter(el => el.required && ['text', 'email', 'textarea'].includes(el.type)).forEach(el => {
        el.setCustomValidity(el.value.trim() ? '' : 'This field cannot be blank.');
      });
      if (form.id === 'supportReply') {
        form.elements.body.setCustomValidity(form.elements.body.value.trim() ? '' : 'Enter a reply before posting.');
      }
      if (form.id === 'supportEdit') {
        const assignee = form.elements.assigned_to;
        assignee.setCustomValidity(assignee.value && !agents.some(a => String(a.id) === assignee.value) ? 'Choose an active support agent or Unassigned.' : '');
      }
      if (form.id === 'supportUpload') {
        const control = form.elements.attachment, file = control.files[0];
        control.setCustomValidity(file && file.size > 0 && file.size <= 5242880 && (!file.type || ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) ? '' : 'Choose a JPG, PNG or PDF file up to 5 MB.');
      }
      if (!form.reportValidity()) return;
      const actions = { supportCreate: 'create', supportEdit: 'update', supportReply: 'reply', supportNote: 'note', supportUpload: 'attachment' };
      if (actions[form.id]) write(actions[form.id], values(form), form.id === 'supportUpload' ? form.elements.attachment.files[0] : undefined);
    });
    root.addEventListener('input', event => { if (event.target.setCustomValidity) event.target.setCustomValidity(''); });
    root.addEventListener('change', event => { if (event.target.closest('#supportEdit')) resolution(); });
    root.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b || b.disabled || busy || detailLoading) return;
      if (b.dataset.ticket) { loadDetail(b.dataset.ticket); return; }
      const action = b.dataset.action;
      if (action === 'clear') { filters.reset(); page = 1; loadList(); }
      if (action === 'refresh') loadList();
      if (action === 'previous' && page > 1) { --page; loadList(); }
      if (action === 'next' && page < pages) { ++page; loadList(); }
      if (action === 'reload' && selected) loadDetail(selected.id, 1, true);
      if (action === 'older') loadDetail(selected.id, entryPage + 1);
      if (action === 'newer') loadDetail(selected.id, entryPage - 1);
      if (action === 'draft') write('draft', { body: byId('supportReply').elements.body.value });
      if (action === 'close' && (!dirty() || window.confirm('Discard unsaved ticket changes? Save your reply as a draft to keep it.'))) {
        selected = null; conflict = false; byId('supportDetail').hidden = true; byId('supportDetail').innerHTML = ''; message('supportDetailMessage'); filters.elements.search.focus();
      }
    });
    filters.addEventListener('input', event => {
      clearTimeout(timer); ++listSeq;
      page = 1;
      if (event.target.type === 'search') timer = setTimeout(loadList, 300);
      else loadList();
    });
    window.addEventListener('beforeunload', event => {
      if (dirty() || (metadataReady && JSON.stringify(values(createForm)) !== createBaseline)) { event.preventDefault(); event.returnValue = ''; }
    });
    lock(); loadList();
  };
}());
