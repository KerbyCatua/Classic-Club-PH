(function () {
  'use strict';
  window.initSupportTickets = function ({ byId, escapeHtml: esc, showToast, getCsrfToken, refreshOverview }) {
    const root = byId('module-tickets');
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const statusOptions = [['open', 'Open'], ['in_progress', 'In Progress'], ['resolved', 'Resolved'], ['closed', 'Closed']];
    const priorities = ['Critical', 'High', 'Medium', 'Low'];
    let categories = [], agents = [], selected = null, page = 1, pages = 1, entryPage = 1, busy = false, listSeq = 0, detailSeq = 0;
    const options = (items, blank) => (blank === undefined ? '' : '<option value="">' + esc(blank) + '</option>') + items.map(x => '<option value="' + esc(Array.isArray(x) ? x[0] : x) + '">' + esc(Array.isArray(x) ? x[1] : x) + '</option>').join('');
    const select = (name, label, items, blank) => '<label class="d-flex flex-column gap-1 text-muted-cc">' + label + '<select name="' + name + '" class="admin-select-filter">' + options(items, blank) + '</select></label>';
    const input = (name, label, max, type = 'text', required = true) => '<label class="d-flex flex-column gap-1 text-muted-cc">' + label + '<input class="admin-input-filter" name="' + name + '" type="' + type + '" maxlength="' + max + '" ' + (required ? 'required' : '') + '></label>';
    const textarea = (name, label, required = true) => '<label class="d-flex flex-column gap-1 text-muted-cc">' + label + '<textarea class="admin-input-filter" name="' + name + '" rows="3" maxlength="10000" ' + (required ? 'required' : '') + '></textarea></label>';
    const button = (text, action) => '<button type="button" class="btn-admin-outline" data-action="' + action + '">' + text + '</button>';
    const date = value => value ? value + ' PHT' : 'Pending';
    root.innerHTML = '<span class="admin-section-eyebrow">21.8 / CLASSIC CLUB PH</span><h2 class="admin-section-title mb-2">Support ticket management</h2>' +
      '<p class="admin-section-desc">Customer inquiries and administrator requests. Replies are saved in the support record; linked business administrators receive an in-app notification.</p>' +
      '<div id="supportStats" class="row g-3 mb-4" aria-live="polite"></div>' +
      '<details class="admin-card mb-4"><summary class="text-light-cc">Create ticket</summary><form id="supportCreate" class="d-flex flex-column gap-3 mt-3">' +
      input('full_name', 'Requester name', 160) + input('email', 'Requester email', 190, 'email') + input('subject', 'Subject', 200) + input('order_number', 'Order number (optional)', 30, 'text', false) +
      '<div class="row g-3"><div class="col-md-4" id="supportCreateCategory"></div><div class="col-md-4">' + select('priority', 'Priority', priorities) + '</div><div class="col-md-4" id="supportCreateAgent"></div></div>' +
      textarea('message', 'Request message') + '<button class="btn-admin-primary" type="submit">Create ticket</button></form></details>' +
      '<form id="supportFilters" class="d-flex flex-wrap gap-2 mb-3">' + input('search', 'Search ID, requester, email or message', 200, 'search', false) + select('status', 'Status', statusOptions, 'All') + select('priority', 'Priority', priorities, 'All') +
      '<span id="supportFilterCategory"></span><span id="supportFilterAgent"></span><button type="submit" class="btn-admin-outline">Search</button>' + button('Refresh', 'refresh') + '</form>' +
      '<p id="supportError" role="alert" class="text-danger"></p><div class="admin-table-container"><table class="admin-table sa-table-wide"><thead><tr><th>Ticket / requester</th><th>Category</th><th>Priority</th><th>Status</th><th>Assigned support</th><th>Created / updated (PHT)</th><th>Action</th></tr></thead><tbody id="supportRows"></tbody></table></div>' +
      '<div class="d-flex gap-3 align-items-center my-3">' + button('Previous', 'previous') + '<span id="supportPage" aria-live="polite"></span>' + button('Next', 'next') + '</div>' +
      '<div id="supportDetail" class="admin-card" hidden></div>';
    byId('supportCreate').elements.priority.value = 'Medium';
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
        const error = new Error(payload.error?.message || 'Unable to access support tickets.'); error.status = response.status; throw error;
      }
      return payload.data;
    }
    const agentOptions = () => agents.map(a => [String(a.id), a.name]);
    function metadata(data) {
      const saved = ['supportCreate', 'supportFilters'].map(id => {
        const form = byId(id); return [form, form.elements.category?.value, form.elements.assigned_to?.value];
      });
      categories = data.categories; agents = data.agents;
      byId('supportCreateCategory').innerHTML = select('category', 'Category', categories);
      byId('supportCreateAgent').innerHTML = select('assigned_to', 'Assigned support', agentOptions(), 'Unassigned');
      byId('supportFilterCategory').innerHTML = select('category', 'Category', categories, 'All');
      byId('supportFilterAgent').innerHTML = select('assigned_to', 'Assigned support', [['unassigned', 'Unassigned'], ...agentOptions()], 'All');
      saved.forEach(([form, category, assignee]) => {
        if (category !== undefined) form.elements.category.value = category;
        if (assignee !== undefined) form.elements.assigned_to.value = assignee;
      });
    }
    function lock() {
      root.querySelectorAll('button').forEach(b => { b.disabled = busy; });
      if (!busy) {
        root.querySelector('[data-action="previous"]').disabled = page <= 1;
        root.querySelector('[data-action="next"]').disabled = page >= pages;
      }
    }
    async function loadList() {
      const seq = ++listSeq;
      try {
        const params = Object.fromEntries(new FormData(byId('supportFilters'))); params.page = page;
        const data = await api(params);
        if (seq !== listSeq) return;
        metadata(data); page = data.page; pages = data.pages;
        byId('supportError').textContent = '';
        byId('supportRows').innerHTML = data.rows.map(t => '<tr><td><strong>INQ-' + esc(t.id) + '</strong><div>' + esc(t.subject) + '</div><small>' + esc(t.full_name) + ' · ' + esc(t.email) + '</small></td><td>' + esc(t.category) + '</td><td>' + esc(t.priority) + '</td><td>' + esc(statusOptions.find(s => s[0] === t.status)?.[1] || t.status) + '</td><td>' + esc(t.assignee || 'Unassigned') + '</td><td>' + esc(t.created_at) + '<br>' + esc(t.updated_at) + '</td><td><button type="button" class="btn-admin-outline" data-ticket="' + esc(t.id) + '">Open</button></td></tr>').join('') || '<tr><td colspan="7">No matching support tickets.</td></tr>';
        byId('supportPage').textContent = data.total + ' tickets · Page ' + page + ' / ' + pages;
        const stats = data.stats;
        byId('supportStats').innerHTML = [['Unresolved', stats.unresolved || 0], ['Resolved / closed', stats.completed || 0], ['Average first response', stats.response_minutes == null ? '—' : Math.round(stats.response_minutes) + ' min'], ['Average resolution', stats.resolution_minutes == null ? '—' : Math.round(stats.resolution_minutes) + ' min']].map(([label, value]) => '<div class="col-sm-6 col-xl-3"><div class="admin-card"><span class="admin-card-label">' + label + '</span><div class="admin-card-stat">' + esc(value) + '</div></div></div>').join('');
        lock();
      } catch (error) {
        if (seq !== listSeq) return;
        byId('supportError').textContent = error.message;
        byId('supportRows').innerHTML = '<tr><td colspan="7">Ticket list unavailable. Use Refresh to retry.</td></tr>';
      }
    }
    function renderDetail(data) {
      selected = data.ticket; entryPage = data.page;
      const t = selected, panel = byId('supportDetail'); panel.hidden = false;
      panel.innerHTML = '<div class="d-flex justify-content-between"><h3 class="font-lora">INQ-' + esc(t.id) + ' · ' + esc(t.subject) + '</h3>' + button('Reload ticket', 'reload') + '</div>' +
        '<p>' + esc(t.full_name) + ' · ' + esc(t.email) + ' · Order: ' + esc(t.order_number || 'None') + '</p>' +
        '<p class="text-muted-cc">Created: ' + esc(date(t.created_at)) + ' · Updated: ' + esc(date(t.updated_at)) + '<br>First response: ' + esc(date(t.first_response_at)) + ' · Resolved: ' + esc(date(t.resolved_at)) + ' · Closed: ' + esc(date(t.closed_at)) + '</p>' +
        '<div class="sa-list-row"><strong>Original request</strong><p style="white-space:pre-wrap">' + esc(t.message) + '</p></div>' +
        '<form id="supportEdit" class="d-flex flex-column gap-3 my-4">' + input('subject', 'Subject', 200) + '<div class="d-flex flex-wrap gap-3">' + select('status', 'Status', statusOptions) + select('priority', 'Priority', priorities) + select('category', 'Category', categories) + select('assigned_to', 'Assigned support', agentOptions(), 'Unassigned') + '</div>' + textarea('resolution_summary', 'Resolution summary (required to resolve or close)', false) + '<button type="submit" class="btn-admin-primary">Save ticket changes</button></form>' +
        '<h4>Conversation and management history</h4><p class="text-muted-cc">Newest entries first. Internal notes and history are restricted to support administrators.</p>' +
        data.entries.map(e => '<div class="sa-list-row"><strong>' + esc(e.kind === 'reply' ? 'Reply' : e.kind === 'note' ? 'Internal note' : 'History') + ' · ' + esc(e.author || 'Deleted user') + ' · ' + esc(date(e.created_at)) + '</strong><p style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(e.body) + '</p></div>').join('') +
        '<div class="d-flex gap-2 my-3">' + (data.page > 1 ? button('Newer entries', 'newer') : '') + '<span>Page ' + data.page + ' / ' + data.pages + ' · ' + data.total + ' entries</span>' + (data.page < data.pages ? button('Older entries', 'older') : '') + '</div>' +
        '<form id="supportReply" class="d-flex flex-column gap-3 mb-4">' + textarea('body', 'Reply / saved draft', false) + '<div class="d-flex gap-2">' + button('Save draft', 'draft') + '<button class="btn-admin-primary" type="submit">Post reply</button></div><small class="text-muted-cc">Saved to this conversation. In-app notifications go to businesses linked to the requester. Email delivery is not configured.</small></form>' +
        '<form id="supportNote" class="d-flex flex-column gap-3 mb-4">' + textarea('body', 'Internal note (restricted)') + '<button class="btn-admin-outline" type="submit">Add internal note</button></form>' +
        '<h4>Attachments</h4><ul>' + data.attachments.map(a => '<li><a class="text-accent" href="public/api/super-admin/ticket-attachment.php?id=' + esc(a.id) + '">' + esc(a.original_name) + '</a> (' + esc(a.file_size) + ' bytes)</li>').join('') + '</ul>' +
        '<form id="supportUpload" class="d-flex flex-column gap-3"><label>Attach JPG, PNG or PDF (maximum 5 MB)<input class="admin-input-filter d-block" name="attachment" type="file" accept="image/jpeg,image/png,application/pdf" required></label><button class="btn-admin-outline" type="submit">Add attachment</button></form>';
      const form = byId('supportEdit');
      ['subject', 'status', 'priority', 'category', 'assigned_to', 'resolution_summary'].forEach(k => {
        if (k === 'assigned_to' && t[k] && !agents.some(a => String(a.id) === String(t[k]))) {
          form.elements[k].add(new Option((t.assignee || 'Unavailable agent') + ' (inactive)', t[k]));
        }
        form.elements[k].value = t[k] ?? '';
      });
      byId('supportReply').elements.body.value = data.draft;
      lock();
    }
    async function loadDetail(id, historyPage = 1) {
      const seq = ++detailSeq;
      try {
        const data = await api({ id, page: historyPage });
        if (seq !== detailSeq) return;
        renderDetail(data);
      } catch (error) { if (seq === detailSeq) showToast(error.message, 'error'); }
    }
    async function write(action, fields = {}, file) {
      if (busy || (action !== 'create' && !selected)) return;
      busy = true; lock(); ++detailSeq;
      try {
        const data = await api(null, { action, ...(selected ? { id: selected.id, version: selected.version, updated_at: selected.updated_at } : {}), ...fields }, file);
        renderDetail(data);
        if (action === 'create') { byId('supportCreate').reset(); byId('supportCreate').elements.priority.value = 'Medium'; }
        showToast(action === 'reply' ? 'Reply saved to the conversation.' : 'Support ticket saved.');
        await loadList();
        if (refreshOverview && action !== 'draft') refreshOverview();
      } catch (error) {
        showToast(error.message, 'error');
        if (error.status === 409) byId('supportError').textContent = 'Ticket changed. Copy any unsaved text, then use Reload ticket to review the latest record.';
      } finally { busy = false; lock(); }
    }
    root.addEventListener('submit', event => {
      event.preventDefault(); const form = event.target;
      if (form.id === 'supportFilters') { page = 1; loadList(); }
      if (form.id === 'supportCreate') write('create', Object.fromEntries(new FormData(form)));
      if (form.id === 'supportEdit') write('update', Object.fromEntries(new FormData(form)));
      if (form.id === 'supportReply') write('reply', Object.fromEntries(new FormData(form)));
      if (form.id === 'supportNote') write('note', Object.fromEntries(new FormData(form)));
      if (form.id === 'supportUpload') write('attachment', {}, form.elements.attachment.files[0]);
    });
    root.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b || busy) return;
      if (b.dataset.ticket) { loadDetail(b.dataset.ticket); return; }
      const action = b.dataset.action;
      if (action === 'refresh') loadList();
      if (action === 'previous' && page > 1) { --page; loadList(); }
      if (action === 'next' && page < pages) { ++page; loadList(); }
      if (action === 'reload' && selected) loadDetail(selected.id);
      if (action === 'older') loadDetail(selected.id, entryPage + 1);
      if (action === 'newer') loadDetail(selected.id, entryPage - 1);
      if (action === 'draft') write('draft', { body: byId('supportReply').elements.body.value });
    });
    let timer;
    byId('supportFilters').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; loadList(); }, 300); });
    loadList();
  };
}());
