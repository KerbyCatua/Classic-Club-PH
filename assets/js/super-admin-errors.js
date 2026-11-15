/* Module 21.6 only. */
window.initErrorManagement = function ({ showToast, escapeHtml: esc, getCsrfToken }) {
  const root = document.getElementById('module-errors');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const byId = id => root.querySelector('#' + id);
  const form = byId('errorTriageForm');
  const filters = { search: 'errorSearchInput', severity: 'errorSeverityFilter', date: 'errorDateFilter', module: 'errorModuleFilter', state: 'errorStateFilter', recurring: 'errorRecurringFilter' };
  let page = 1, pages = 1, eventPage = 1, eventPages = 1, detail = null;
  let listSeq = 0, detailSeq = 0, loading = false, detailLoading = false, saving = false, conflict = false, timer, baseline = '';
  const date = value => value ? String(value) : '—';
  const count = value => Number(value).toLocaleString('en-PH');
  const cell = value => `<span class="error-cell" title="${esc(String(value))}">${esc(String(value))}</span>`;
  const badge = (value, severity = false) => {
    const variants = severity ? { Critical: 'danger', High: 'danger', Medium: 'warning', Low: 'info' } : { Resolved: 'success', Unresolved: 'warning' };
    return `<span class="sa-badge sa-badge-${variants[value] || 'neutral'}">${esc(value)}</span>`;
  };
  const draft = () => JSON.stringify([byId('errorSeverity').value, byId('errorState').value, byId('errorReviewer').value, byId('errorIncident').value, byId('errorNote').value, byId('errorReviewedCheck').checked]);
  const dirty = () => !!detail && draft() !== baseline;
  const discard = () => !dirty() || window.confirm('Discard unsaved changes?');
  function buttons() {
    byId('errorPrev').disabled = saving || loading || page <= 1;
    byId('errorNext').disabled = saving || loading || page >= pages;
    byId('errorRefresh').disabled = saving || loading;
    byId('errorDetailReload').disabled = saving || detailLoading;
    byId('errorDetailClose').disabled = saving;
    byId('errorEventPrev').disabled = saving || detailLoading || eventPage <= 1;
    byId('errorEventNext').disabled = saving || detailLoading || eventPage >= eventPages;
    form.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = !detail || saving || detailLoading; });
    form.querySelector('[type="submit"]').disabled = !detail || saving || detailLoading || conflict || !dirty();
    byId('errorGroupsTableBody').querySelectorAll('button').forEach(el => { el.disabled = saving; });
    byId('errorGroupsViewport').setAttribute('aria-busy', String(loading));
    byId('errorDetailPanel').setAttribute('aria-busy', String(saving || detailLoading));
  }
  function selectRow() {
    byId('errorGroupsTableBody').querySelectorAll('[data-error-id]').forEach(button => {
      const selected = Number(detail?.group.id) === Number(button.dataset.errorId);
      button.closest('tr').classList.toggle('sa-selected-row', selected);
      button.setAttribute('aria-expanded', String(selected));
    });
  }
  async function api(params, body, retry = false) {
    const headers = { Accept: 'application/json' };
    if (body) { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = await getCsrfToken(retry); }
    const response = await fetch('public/api/super-admin/errors.php' + (params ? '?' + new URLSearchParams(params) : ''), {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (body && response.status === 403 && !retry) return api(params, body, true);
    if (!response.ok || !result.success) {
      const error = new Error(result.error?.message || 'Unable to load errors. Try again.');
      error.status = response.status; throw error;
    }
    return result.data;
  }
  async function loadList(resetScroll = false) {
    clearTimeout(timer); timer = null;
    const seq = ++listSeq;
    const params = { page };
    Object.entries(filters).forEach(([key, id]) => { params[key] = byId(id).value.trim(); });
    loading = true; buttons();
    byId('errorSummary').textContent = 'Loading errors...';
    try {
      const data = await api(params);
      if (seq !== listSeq) return;
      page = Number(data.page); pages = Number(data.pages);
      const selectedModule = byId('errorModuleFilter').value;
      const modules = [...new Set([...data.modules, ...(selectedModule ? [selectedModule] : [])])];
      byId('errorModuleFilter').innerHTML = '<option value="">All modules</option>' + modules.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      byId('errorModuleFilter').value = selectedModule;
      byId('errorSummary').textContent = `${count(data.failed_24h)} failed requests in 24h · ${count(data.unresolved)} unresolved errors`;
      byId('errorGroupsTableBody').innerHTML = data.groups.length ? data.groups.map(g => `<tr><td><span class="sa-mono">ERR-${Number(g.id)}</span>${cell(g.summary)}</td><td>${count(g.occurrences)}</td><td>${badge(g.severity, true)}</td><td>${cell(g.module)}</td><td class="error-time">${esc(date(g.last_seen))}</td><td>${badge(g.state)}</td><td><button type="button" class="btn-admin-outline" data-error-id="${Number(g.id)}" aria-label="Details for ERR-${Number(g.id)}" aria-controls="errorDetailPanel">Details</button></td></tr>`).join('') : '<tr><td colspan="7" class="text-muted-cc">No errors found.</td></tr>';
      byId('errorTableNote').textContent = `${count(data.total)} ${Number(data.total) === 1 ? 'error' : 'errors'} · Page ${page} of ${pages}`;
      if (resetScroll) byId('errorGroupsViewport').scrollTop = 0;
      selectRow();
    } catch (error) {
      if (seq !== listSeq) return;
      byId('errorSummary').textContent = error.message;
      byId('errorGroupsTableBody').innerHTML = '<tr><td colspan="7" class="text-muted-cc">Errors unavailable. Select Refresh to retry.</td></tr>';
      byId('errorTableNote').textContent = '';
      page = pages = 1;
    } finally {
      if (seq === listSeq) { loading = false; buttons(); }
    }
  }
  function renderEvents(data) {
    eventPage = Number(data.event_page); eventPages = Number(data.event_pages);
    byId('errorRequestsBody').innerHTML = data.events.length ? data.events.map(e => `<tr><td class="sa-mono">${cell(e.request_id)}</td><td class="error-time">${esc(date(e.occurred_at))}</td><td>${cell(e.method + ' ' + e.endpoint)}</td><td>${Number(e.http_status)}</td><td>${Number(e.duration_ms).toFixed(1)} ms</td><td>${cell(e.source)}</td></tr>`).join('') : '<tr><td colspan="6" class="text-muted-cc">No occurrences recorded.</td></tr>';
    byId('errorEventNote').textContent = `${count(data.group.occurrences)} ${Number(data.group.occurrences) === 1 ? 'occurrence' : 'occurrences'} · Page ${eventPage} of ${eventPages}`;
    byId('errorEventsViewport').scrollTop = 0;
  }
  function renderDetail(data) {
    detail = data; conflict = false;
    const g = data.group, latest = data.events[0];
    byId('errorDetailPanel').hidden = false;
    byId('errorDetailStatus').textContent = '';
    byId('errorDetailCode').textContent = 'ERR-' + g.id;
    byId('errorDetailSummary').textContent = g.summary;
    byId('errorDetailMeta').textContent = `${g.severity} · ${g.state} · ${count(g.occurrences)} occurrences · ${g.module}`;
    byId('errorDetailTimes').textContent = `First: ${date(g.first_seen)} · Latest: ${date(g.last_seen)} (PHT)`;
    byId('errorDetailEndpoint').textContent = latest ? `${latest.method} ${latest.endpoint} · HTTP ${latest.http_status}` : 'No request recorded.';
    byId('errorDetailContext').textContent = g.reviewed_at ? `Reviewed: ${date(g.reviewed_at)} (PHT)` : 'Not reviewed';
    byId('errorDetailStack').textContent = latest?.stack || 'No source frames recorded.';
    byId('errorSourceDetails').open = false;
    byId('errorSeverity').value = g.severity; byId('errorState').value = g.state;
    byId('errorReviewer').innerHTML = '<option value="">Unassigned</option>' + data.reviewers.map(r => `<option value="${Number(r.id)}">${esc(r.name)}</option>`).join('');
    if (g.reviewer_id && !data.reviewers.some(r => Number(r.id) === Number(g.reviewer_id))) byId('errorReviewer').insertAdjacentHTML('beforeend', `<option value="${Number(g.reviewer_id)}">Inactive reviewer #${Number(g.reviewer_id)}</option>`);
    byId('errorReviewer').value = g.reviewer_id || '';
    byId('errorIncident').innerHTML = '<option value="">None</option>' + data.incidents.map(i => `<option value="${Number(i.id)}">CHECK-${Number(i.id)} · ${esc(i.service)} · ${esc(date(i.checked_at))}</option>`).join('');
    if (g.incident_id && !data.incidents.some(i => Number(i.id) === Number(g.incident_id))) byId('errorIncident').insertAdjacentHTML('beforeend', `<option value="${Number(g.incident_id)}">Unavailable check #${Number(g.incident_id)}</option>`);
    byId('errorIncident').value = g.incident_id || '';
    byId('errorNote').value = ''; byId('errorReviewedCheck').checked = !!g.reviewed_at;
    byId('errorHistory').innerHTML = data.history.length ? data.history.map(h => {
      const before = h.metadata?.before || {}, after = h.metadata?.after || {};
      const changes = [];
      if (before.state !== after.state) changes.push(`${before.state} → ${after.state}`);
      if (before.severity !== after.severity) changes.push(`Severity: ${after.severity}`);
      if (String(before.reviewer_id || '') !== String(after.reviewer_id || '')) changes.push(`Reviewer: ${data.reviewers.find(r => Number(r.id) === Number(after.reviewer_id))?.name || (after.reviewer_id ? '#' + after.reviewer_id : 'Unassigned')}`);
      if (String(before.incident_id || '') !== String(after.incident_id || '')) changes.push(`Health check: ${after.incident_id ? 'CHECK-' + after.incident_id : 'None'}`);
      if (before.reviewed_at !== after.reviewed_at) changes.push(after.reviewed_at ? 'Reviewed' : 'Review cleared');
      return `<div class="sa-list-row"><div class="sa-list-title">${esc(h.actor || 'Deleted account')} · ${esc(date(h.created_at))} PHT</div>${changes.length ? `<div class="sa-list-meta">${esc(changes.join(' · '))}</div>` : ''}${h.metadata?.note ? `<div class="sa-list-meta" style="white-space:pre-wrap">${esc(h.metadata.note)}</div>` : ''}</div>`;
    }).join('') : '<p class="text-muted-cc small mb-0">No triage history.</p>';
    byId('errorHistory').scrollTop = 0;
    baseline = draft();
    renderEvents(data); selectRow();
  }
  async function loadDetail(id, requestedPage = 1, reset = true, focus = false) {
    if (saving || (reset && !discard())) return;
    const seq = ++detailSeq;
    detailLoading = true; buttons();
    byId('errorDetailStatus').textContent = 'Loading details...';
    try {
      const data = await api({ id, event_page: requestedPage });
      if (seq !== detailSeq) return;
      if (reset) renderDetail(data);
      else { renderEvents(data); byId('errorDetailStatus').textContent = ''; }
      if (focus) byId('errorDetailHeading').focus();
    } catch (error) {
      if (seq !== detailSeq) return;
      byId('errorDetailStatus').textContent = error.message;
    } finally {
      if (seq === detailSeq) { detailLoading = false; buttons(); }
    }
  }
  async function save() {
    if (!detail || saving || detailLoading || conflict || !dirty()) return;
    if (new TextEncoder().encode(byId('errorNote').value).length > 4000) {
      byId('errorDetailStatus').textContent = 'Note is too long. Use at most 4,000 UTF-8 bytes.';
      byId('errorNote').focus(); return;
    }
    saving = true; buttons();
    byId('errorDetailStatus').textContent = 'Saving...';
    try {
      const data = await api(null, {
        id: Number(detail.group.id), version: Number(detail.group.version), severity: byId('errorSeverity').value,
        state: byId('errorState').value, reviewer_id: Number(byId('errorReviewer').value) || null,
        incident_id: Number(byId('errorIncident').value) || null, note: byId('errorNote').value, reviewed: byId('errorReviewedCheck').checked
      });
      renderDetail(data); showToast('Error saved.', 'success'); await loadList();
    } catch (error) {
      conflict = error.status === 409;
      byId('errorDetailStatus').textContent = error.message;
      showToast(error.message, 'error');
    } finally { saving = false; buttons(); }
  }
  Object.entries(filters).forEach(([key, id]) => byId(id).addEventListener(key === 'search' ? 'input' : 'change', () => {
    clearTimeout(timer); ++listSeq; page = 1; loading = true; buttons();
    timer = setTimeout(() => loadList(true), key === 'search' ? 300 : 0);
  }));
  byId('errorReset').addEventListener('click', () => {
    Object.values(filters).forEach(id => { byId(id).value = ''; }); page = 1; loadList(true);
  });
  byId('errorRefresh').addEventListener('click', () => { if (!saving && !loading) loadList(); });
  byId('errorPrev').addEventListener('click', () => { if (!saving && !loading && page > 1) { --page; loadList(true); } });
  byId('errorNext').addEventListener('click', () => { if (!saving && !loading && page < pages) { ++page; loadList(true); } });
  byId('errorGroupsTableBody').addEventListener('click', event => {
    const button = event.target.closest('[data-error-id]');
    if (button) loadDetail(button.dataset.errorId, 1, true, true);
  });
  byId('errorEventPrev').addEventListener('click', () => { if (detail && !detailLoading && eventPage > 1) loadDetail(detail.group.id, eventPage - 1, false); });
  byId('errorEventNext').addEventListener('click', () => { if (detail && !detailLoading && eventPage < eventPages) loadDetail(detail.group.id, eventPage + 1, false); });
  byId('errorDetailReload').addEventListener('click', () => { if (detail) loadDetail(detail.group.id); });
  byId('errorDetailClose').addEventListener('click', () => {
    if (saving || !discard()) return;
    const id = detail?.group.id;
    ++detailSeq; detailLoading = false; detail = null; conflict = false;
    byId('errorDetailPanel').hidden = true;
    byId('errorDetailStatus').textContent = 'Select Details to review an error.';
    selectRow(); buttons();
    (byId('errorGroupsTableBody').querySelector(`[data-error-id="${Number(id)}"]`) || byId('errorGroupsViewport')).focus();
  });
  form.addEventListener('input', buttons);
  form.addEventListener('change', buttons);
  form.addEventListener('submit', event => { event.preventDefault(); save(); });
  buttons(); loadList();
  setInterval(() => {
    const rect = root.getBoundingClientRect();
    if (!document.hidden && !saving && !loading && !timer && rect.top < window.innerHeight && rect.bottom > 0) loadList();
  }, 30000);
};
