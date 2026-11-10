/* Module 21.6 only. */
window.initErrorManagement = function ({ byId, showToast, escapeHtml: esc, getCsrfToken }) {
  let page = 1, pages = 1, eventPage = 1, eventPages = 1, detail = null;
  let listSeq = 0, detailSeq = 0, saving = false, timer;
  const filters = { search: 'errorSearchInput', severity: 'errorSeverityFilter', date: 'errorDateFilter', module: 'errorModuleFilter', state: 'errorStateFilter', recurring: 'errorRecurringFilter' };
  const form = byId('errorTriageForm');
  const date = value => value ? String(value) + ' PHT' : '—';
  const controls = disabled => form.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = disabled; });
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
      const error = new Error(result.error?.message || 'Unable to access error management.');
      error.status = response.status; throw error;
    }
    return result.data;
  }
  function listButtons() { byId('errorPrev').disabled = saving || page <= 1; byId('errorNext').disabled = saving || page >= pages; }
  async function loadList() {
    const seq = ++listSeq;
    const params = { page };
    Object.entries(filters).forEach(([key, id]) => { params[key] = byId(id).value; });
    byId('errorSummary').textContent = 'Loading recorded failures...';
    try {
      const data = await api(params);
      if (seq !== listSeq) return;
      page = data.page; pages = data.pages;
      const selectedModule = byId('errorModuleFilter').value;
      byId('errorModuleFilter').innerHTML = '<option value="">All modules</option>' + data.modules.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      byId('errorModuleFilter').value = selectedModule;
      byId('errorSummary').textContent = `${data.failed_24h} failed requests in the last 24 hours · ${data.unresolved} unresolved groups overall`;
      byId('errorGroupsTableBody').innerHTML = data.groups.length ? data.groups.map(g => `<tr${Number(detail?.group.id) === Number(g.id) ? ' class="sa-selected-row"' : ''}><td class="sa-mono">ERR-${Number(g.id)}<div>${Number(g.occurrences)} occurrence(s)</div></td><td>${esc(g.severity)}</td><td>${esc(g.module)}</td><td>${esc(date(g.last_seen))}</td><td>${esc(g.state)}</td><td>${esc(g.summary)}</td><td><button type="button" class="btn-admin-outline" data-error-id="${Number(g.id)}">Details</button></td></tr>`).join('') : '<tr><td colspan="7" class="text-muted-cc">No recorded error groups match these filters.</td></tr>';
      byId('errorTableNote').textContent = `${data.total} matching groups · Page ${page} of ${pages}`;
    } catch (error) {
      if (seq !== listSeq) return;
      byId('errorSummary').textContent = error.message;
      byId('errorGroupsTableBody').innerHTML = '';
      byId('errorTableNote').textContent = 'Unavailable. Use Refresh to retry.';
      page = pages = 1;
    }
    if (seq === listSeq) listButtons();
  }
  function renderDetail(data, resetForm = true) {
    detail = data;
    const g = data.group;
    eventPage = Number(data.event_page); eventPages = Number(data.event_pages);
    byId('errorDetailPanel').hidden = false;
    byId('errorDetailPanel').classList.remove('d-none');
    byId('errorDetailStatus').textContent = '';
    byId('errorDetailCode').textContent = 'ERR-' + g.id;
    byId('errorDetailMeta').textContent = `${g.severity} / ${g.state} / ${g.occurrences} occurrence(s) / First ${date(g.first_seen)} / Latest ${date(g.last_seen)}`;
    const latest = data.events[0];
    byId('errorDetailEndpoint').textContent = latest ? `${latest.method} ${latest.endpoint} / HTTP ${latest.http_status}` : g.summary;
    byId('errorDetailContext').textContent = `Reviewed: ${date(g.reviewed_at)} · Version ${g.version}`;
    byId('errorDetailStack').textContent = latest?.stack || 'No source frames available for this record.';
    if (resetForm) {
      byId('errorSeverity').value = g.severity; byId('errorState').value = g.state;
      byId('errorReviewer').innerHTML = '<option value="">Unassigned</option>' + data.reviewers.map(r => `<option value="${Number(r.id)}">${esc(r.name)}</option>`).join('');
      if (g.reviewer_id && !data.reviewers.some(r => Number(r.id) === Number(g.reviewer_id))) byId('errorReviewer').insertAdjacentHTML('beforeend', `<option value="${Number(g.reviewer_id)}">Inactive reviewer #${Number(g.reviewer_id)} (reassign to save)</option>`);
      byId('errorReviewer').value = g.reviewer_id || '';
      byId('errorIncident').innerHTML = '<option value="">None</option>' + data.incidents.map(i => `<option value="${Number(i.id)}">CHECK-${Number(i.id)} / ${esc(i.service)} / ${esc(date(i.checked_at))} / ${esc(i.status)}</option>`).join('');
      byId('errorIncident').value = g.incident_id || '';
      byId('errorNote').value = ''; byId('errorReviewedCheck').checked = !!g.reviewed_at;
    }
    byId('errorHistory').innerHTML = data.history.length ? data.history.map(h => `<div class="sa-list-row"><div class="sa-list-title">${esc(h.actor || 'Deleted account')} · ${esc(date(h.created_at))}</div><div class="sa-list-meta">${esc(h.metadata?.before?.state || '')} → ${esc(h.metadata?.after?.state || '')} / ${esc(h.metadata?.after?.severity || '')} / Reviewer ${esc(String(h.metadata?.after?.reviewer_id || 'Unassigned'))} / Check ${esc(String(h.metadata?.after?.incident_id || 'None'))}</div><div class="sa-list-meta" style="white-space:pre-wrap">${esc(h.metadata?.note || 'Triage updated.')}</div></div>`).join('') : '<p class="text-muted-cc">No triage actions recorded.</p>';
    byId('errorRequestsBody').innerHTML = data.events.map(e => `<tr><td class="sa-mono">${esc(e.request_id)}</td><td>${esc(date(e.occurred_at))}</td><td>${esc(e.method)} ${esc(e.endpoint)}</td><td>${Number(e.http_status)}</td><td>${Number(e.duration_ms).toFixed(1)} ms</td><td>${esc(e.source)}</td></tr>`).join('');
    byId('errorEventNote').textContent = `Page ${eventPage} of ${eventPages} · Latest 30 triage actions shown`;
    byId('errorEventPrev').disabled = saving || eventPage <= 1;
    byId('errorEventNext').disabled = saving || eventPage >= eventPages;
    controls(saving);
  }
  async function loadDetail(id, requestedPage = 1, reset = true) {
    if (saving) return;
    const seq = ++detailSeq;
    controls(true);
    byId('errorDetailStatus').textContent = 'Loading error details...';
    try {
      const data = await api({ id, event_page: requestedPage });
      if (seq !== detailSeq) return;
      renderDetail(data, reset);
    } catch (error) {
      if (seq !== detailSeq) return;
      detail = null; byId('errorDetailPanel').hidden = true;
      byId('errorDetailPanel').classList.add('d-none');
      byId('errorDetailStatus').textContent = error.message;
    }
  }
  async function save(forcedState) {
    if (!detail || saving) return;
    saving = true; controls(true); listButtons();
    try {
      const data = await api(null, {
        id: Number(detail.group.id), version: Number(detail.group.version), severity: byId('errorSeverity').value,
        state: forcedState || byId('errorState').value, reviewer_id: Number(byId('errorReviewer').value) || null,
        incident_id: Number(byId('errorIncident').value) || null, note: byId('errorNote').value, reviewed: byId('errorReviewedCheck').checked
      });
      renderDetail(data); showToast('Error triage saved.', 'success'); await loadList();
    } catch (error) { showToast(error.message, 'error'); byId('errorDetailStatus').textContent = error.message; }
    finally {
      saving = false; controls(false); listButtons();
      byId('errorEventPrev').disabled = eventPage <= 1;
      byId('errorEventNext').disabled = eventPage >= eventPages;
    }
  }
  Object.entries(filters).forEach(([key, id]) => byId(id).addEventListener(key === 'search' ? 'input' : 'change', () => {
    clearTimeout(timer); ++listSeq; page = 1; timer = setTimeout(loadList, key === 'search' ? 300 : 0);
  }));
  byId('errorRefresh').addEventListener('click', () => { if (!saving) loadList(); });
  byId('errorPrev').addEventListener('click', () => { if (page > 1) { --page; loadList(); } });
  byId('errorNext').addEventListener('click', () => { if (page < pages) { ++page; loadList(); } });
  byId('errorGroupsTableBody').addEventListener('click', event => { const button = event.target.closest('[data-error-id]'); if (button) loadDetail(button.dataset.errorId); });
  byId('errorEventPrev').addEventListener('click', () => { if (detail && eventPage > 1) loadDetail(detail.group.id, eventPage - 1, false); });
  byId('errorEventNext').addEventListener('click', () => { if (detail && eventPage < eventPages) loadDetail(detail.group.id, eventPage + 1, false); });
  form.addEventListener('submit', event => { event.preventDefault(); save(); });
  byId('btnMarkResolved').addEventListener('click', () => save('Resolved'));
  byId('btnReopenError').addEventListener('click', () => save('Unresolved'));
  controls(true); loadList();
  setInterval(() => {
    const rect = byId('module-errors').getBoundingClientRect();
    if (!document.hidden && !saving && rect.top < window.innerHeight && rect.bottom > 0) loadList();
  }, 30000);
};
