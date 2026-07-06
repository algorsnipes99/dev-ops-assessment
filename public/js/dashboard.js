'use strict';

/**
 * Render fleet health rows as HTML table rows.
 * Also used by the SSE live update handler.
 */
window.renderRows = function (rows) {
  return rows.map(function (r) {
    var healthy = r.healthy;
    var statusBadge = healthy
      ? '<span class="badge badge-ok">● Healthy</span>'
      : '<span class="badge badge-fail">● Unhealthy</span>';
    var rowClass = healthy ? 'row-ok' : 'row-fail';

    var servicesHtml = (r.services || [])
      .map(function (s) {
        var svcClass = s.healthy ? 'svc-ok' : 'svc-fail';
        return '<span class="service ' + svcClass + '">' + window.escapeHtml(s.name) + '</span>';
      })
      .join('');

    var ts = r.timestamp ? new Date(r.timestamp).toLocaleString() : '—';
    var cpu = r.cpu_load != null ? r.cpu_load.toFixed(2) : '—';
    var mem = r.mem_used_mb != null ? Number(r.mem_used_mb).toLocaleString() + ' MB' : '—';
    var ip = r.ip || '—';
    var hostLink = '<a href="/host/' + encodeURIComponent(r.host) + '/logs" style="color:inherit;text-decoration:none;">' + window.escapeHtml(r.host) + ' <span class="host-arrow">↗</span></a>';

    return '<tr class="' + rowClass + '">' +
      '<td class="cell-host">' + hostLink + '</td>' +
      '<td class="cell-status">' + statusBadge + '</td>' +
      '<td class="cell-num">' + cpu + '</td>' +
      '<td class="cell-num">' + mem + '</td>' +
      '<td class="cell-ip">' + ip + '</td>' +
      '<td class="cell-svc">' + servicesHtml + '</td>' +
      '<td class="cell-ts">' + ts + '</td>' +
      '</tr>';
  }).join('');
};

/**
 * Escape HTML entities to prevent XSS.
 */
window.escapeHtml = function (str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// --- SSE live updates ---
document.addEventListener('DOMContentLoaded', function () {
  var source = new EventSource('/events/fleet');
  var fleetBody = document.getElementById('fleetBody');
  var hostCountEl = document.getElementById('hostCount');
  var lastUpdatedEl = document.getElementById('lastUpdated');

  source.addEventListener('fleet', function (event) {
    try {
      var payload = JSON.parse(event.data);
      if (!payload.ok || !payload.data) return;

      var rows = payload.data;
      var ts = new Date(payload.timestamp);

      if (hostCountEl) {
        hostCountEl.textContent = rows.length + ' host' + (rows.length !== 1 ? 's' : '') + ' tracked';
      }
      if (lastUpdatedEl) {
        lastUpdatedEl.textContent = 'Updated: ' + ts.toLocaleTimeString();
      }
      if (fleetBody) {
        fleetBody.innerHTML = window.renderRows(rows);
      }
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  });

  source.addEventListener('error', function (event) {
    console.warn('SSE connection error, will auto-reconnect:', event);
  });
});