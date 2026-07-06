'use strict';

/* global config: from window.__LOGS_CONFIG__ injected by server */

var cfg = window.__LOGS_CONFIG__ || {};
var hostId = cfg.hostId;
var fetchParams = cfg.fetchParams;
var currentOffset = cfg.nextOffset || 0;
var loading = false;
var allLoaded = cfg.allLoaded || false;

/**
 * Escape HTML entities to prevent XSS.
 */
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Render a single timeline record (heartbeat or event) as a DOM element.
 * The record comes from the UNION ALL query and has a record_type field.
 */
function renderTimelineRecord(r) {
  var ts = new Date(r.timestamp).toLocaleString();
  if (r.record_type === 'heartbeat') {
    var servicesHtml = (r.services || []).map(function (s) {
      return '<span class="service ' + (s.healthy ? 'svc-ok' : 'svc-fail') + '">' + escapeHtml(s.name) + '</span>';
    }).join('');
    var cpuPct = r.cpu_load != null ? Math.round(r.cpu_load * 100) : 0;
    var memMb = r.mem_used_mb || 0;
    var memPct = Math.min(Math.round((memMb / 16384) * 100), 100);

    var div = document.createElement('div');
    div.className = 'tl-entry tl-telemetry';
    div.innerHTML = '<div class="tl-header"><span class="tl-time">' + ts + '</span><span class="tl-type">Heartbeat</span></div>' +
      '<div class="tl-metrics">' +
      '<span class="metric">CPU <span class="gauge"><span class="gauge-fill gauge-cpu" style="width:' + cpuPct + '%"></span></span> ' + (r.cpu_load != null ? r.cpu_load.toFixed(2) : '—') + '</span>' +
      '<span class="metric">MEM <span class="gauge"><span class="gauge-fill gauge-mem" style="width:' + memPct + '%"></span></span> ' + memMb.toLocaleString() + ' MB</span>' +
      '</div>' +
      '<div class="tl-services">' + servicesHtml + '</div>';
    return div;
  } else if (r.record_type === 'event') {
    var eventType = r.event_type || 'incident';
    var icons = { error: '🟥', warning: '🟨', incident: '🟦' };
    var icon = icons[eventType] || '🟦';
    var div = document.createElement('div');
    div.className = 'tl-entry tl-event tl-event-' + eventType;
    div.innerHTML = '<div class="tl-header"><span class="tl-time">' + ts + '</span><span class="tl-type tl-type-' + eventType + '">' + icon + ' ' + eventType.toUpperCase() + '</span></div>' +
      '<div class="tl-message">' + (r.message || '') + '</div>';
    return div;
  }
}

/**
 * Load the next 20 records and append to the timeline.
 */
async function loadMore() {
  if (loading || allLoaded) return;
  loading = true;
  var btn = document.getElementById('loadMoreBtn');
  if (btn) btn.textContent = 'Loading...';

  try {
    var sep = fetchParams ? '&' : '?';
    var resp = await fetch('/host/' + encodeURIComponent(hostId) + '/history' + fetchParams + sep + 'limit=20&offset=' + currentOffset);
    var json = await resp.json();
    if (!json.ok || !json.data) return;

    var data = json.data;
    var timeline = document.getElementById('timeline');

    // Append timeline records (already sorted by timestamp DESC from UNION ALL)
    (data.timeline || []).forEach(function (r) {
      var el = renderTimelineRecord(r);
      if (el) timeline.appendChild(el);
    });

    currentOffset = data.pagination.offset + (data.timeline || []).length;
    allLoaded = !data.pagination.hasMore;

    // Update counter
    var countEl = document.getElementById('recordCount');
    if (countEl) {
      countEl.textContent = 'Showing ' + currentOffset + ' of ' + data.pagination.total + ' records';
    }

    // Update pagination buttons
    var pagBar = document.getElementById('paginationBar');
    if (allLoaded) {
      if (pagBar) pagBar.innerHTML = '';
    } else {
      if (btn) btn.textContent = 'Show 20 more';
    }
  } catch (e) {
    console.error('Failed to load more:', e);
    if (btn) btn.textContent = 'Show 20 more';
  } finally {
    loading = false;
  }
}

/**
 * Load all records and replace the timeline entirely.
 */
async function loadAll() {
  if (loading || allLoaded) return;
  loading = true;
  var showAllBtn = document.getElementById('showAllBtn');
  if (showAllBtn) showAllBtn.textContent = 'Loading...';

  try {
    var sep = fetchParams ? '&' : '?';
    var resp = await fetch('/host/' + encodeURIComponent(hostId) + '/history' + fetchParams + sep + 'all=true');
    var json = await resp.json();
    if (!json.ok || !json.data) return;

    var data = json.data;
    var timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    // Render all timeline records (already sorted by timestamp DESC)
    (data.timeline || []).forEach(function (r) {
      var el = renderTimelineRecord(r);
      if (el) timeline.appendChild(el);
    });

    var countEl = document.getElementById('recordCount');
    if (countEl) countEl.textContent = (data.timeline || []).length + ' records (all)';

    var pagBar = document.getElementById('paginationBar');
    if (pagBar) pagBar.innerHTML = '';
    allLoaded = true;
  } catch (e) {
    console.error('Failed to load all:', e);
    if (showAllBtn) showAllBtn.textContent = 'Show all';
  } finally {
    loading = false;
  }
}

/**
 * Apply time range filter by reloading the page with query params.
 */
function applyTimeFilter() {
  var start = document.getElementById('startTime').value;
  var end = document.getElementById('endTime').value;
  var base = window.location.pathname;
  var params = [];
  if (start) {
    var startUtc = new Date(start).toISOString();
    params.push('start=' + encodeURIComponent(startUtc));
  }
  if (end) {
    var endUtc = new Date(end).toISOString();
    params.push('end=' + encodeURIComponent(endUtc));
  }
  window.location.href = base + (params.length ? '?' + params.join('&') : '');
}

/**
 * Clear time range filter by reloading the page without query params.
 */
function clearFilter() {
  window.location.href = window.location.pathname;
}

// Wire up button event listeners on DOM ready
document.addEventListener('DOMContentLoaded', function () {
  var loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMore);
  var showAllBtn = document.getElementById('showAllBtn');
  if (showAllBtn) showAllBtn.addEventListener('click', loadAll);
  var applyBtn = document.getElementById('applyBtn');
  if (applyBtn) applyBtn.addEventListener('click', applyTimeFilter);
  var clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearFilter);
});