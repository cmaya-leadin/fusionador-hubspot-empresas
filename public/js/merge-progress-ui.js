const MergeProgressUI = {
  panel: null,
  logEl: null,
  maxLogLines: 200,

  init() {
    this.panel = document.getElementById('mergeProgressPanel');
    this.logEl = document.getElementById('mergeProgressLog');
  },

  show(mode) {
    if (!this.panel) this.init();
    this.panel.classList.remove('hidden');
    this.panel.dataset.mode = mode;
    const titles = {
      apply: 'Fusión en producción',
      simulate: 'Simulación de fusión',
      retry: 'Reintento de fusiones fallidas',
    };
    document.getElementById('mergeProgressTitle').textContent =
      titles[mode] || 'Proceso de fusión';
    document.getElementById('mergeProgressStatus').textContent = 'En curso…';
    document.getElementById('mergeProgressStatus').className = 'merge-progress-status running';
    document.getElementById('mergeProgressBar').style.width = '0%';
    document.getElementById('mergeProgressPercent').textContent = '0%';
    document.getElementById('mergeProgressEta').textContent = 'Calculando tiempo estimado…';
    document.getElementById('mergeProgressMessage').textContent = 'Preparando…';
    document.getElementById('mergeProgressStats').innerHTML = '';
    document.getElementById('mergeProgressSummary').classList.add('hidden');
    if (this.logEl) this.logEl.innerHTML = '';
    this.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  hide() {
    this.panel?.classList.add('hidden');
  },

  /**
   * Restaura el panel desde un snapshot del servidor (sin duplicar eventos).
   * @param {{ mode?: string, status?: string, progress?: object, logs?: object[] }} job
   */
  prepareReconnect(job) {
    if (!this.panel) this.init();
    const mode = job.mode || 'apply';
    const titles = {
      apply: 'Fusión en producción',
      simulate: 'Simulación de fusión',
      retry: 'Reintento de fusiones fallidas',
    };

    this.panel.classList.remove('hidden');
    this.panel.dataset.mode = mode;
    document.getElementById('mergeProgressTitle').textContent = titles[mode] || 'Proceso de fusión';

    const statusEl = document.getElementById('mergeProgressStatus');
    if (job.status === 'completed') {
      statusEl.textContent = 'Finalizado';
      statusEl.className = 'merge-progress-status done';
    } else if (job.status === 'error') {
      statusEl.textContent = 'Error';
      statusEl.className = 'merge-progress-status error';
    } else {
      statusEl.textContent = 'En curso…';
      statusEl.className = 'merge-progress-status running';
    }

    document.getElementById('mergeProgressSummary').classList.add('hidden');
    if (this.logEl) this.logEl.innerHTML = '';
    for (const entry of job.logs || []) {
      this.appendLog(String(entry.message || ''), entry.level || 'info', entry.ts);
    }
    if (job.progress) {
      this.onProgress(job.progress);
    } else if (job.status === 'running') {
      document.getElementById('mergeProgressMessage').textContent = 'Proceso en curso en el servidor…';
    }

    this.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /**
   * @param {number} [ts]
   */
  onProgress(data) {
    const percent = Number(data.percent) || 0;
    document.getElementById('mergeProgressBar').style.width = `${percent}%`;
    document.getElementById('mergeProgressPercent').textContent = `${percent}%`;

    if (data.message) {
      document.getElementById('mergeProgressMessage').textContent = data.message;
    }

    const eta = data.etaSeconds;
    const etaEl = document.getElementById('mergeProgressEta');
    if (eta == null || eta <= 0 || percent >= 100) {
      etaEl.textContent = percent >= 100 ? 'Completado' : 'Calculando tiempo estimado…';
    } else {
      const mins = Math.floor(eta / 60);
      const secs = eta % 60;
      etaEl.textContent = mins > 0
        ? `Tiempo estimado: ~${mins} min ${secs} s`
        : `Tiempo estimado: ~${secs} s`;
    }

    const stats = data.stats || {};
    const chips = [];

    if (stats.recordsRead != null) {
      chips.push(`<span class="merge-stat-chip">Leídos: <strong>${formatNum(stats.recordsRead)}</strong></span>`);
    }
    if (stats.totalRecords != null) {
      chips.push(`<span class="merge-stat-chip">Total: <strong>${formatNum(stats.totalRecords)}</strong></span>`);
    }
    if (stats.mergeGroups != null) {
      chips.push(`<span class="merge-stat-chip">Grupos: <strong>${formatNum(stats.mergeGroups)}</strong></span>`);
    }
    if (stats.mergesPlanned != null) {
      chips.push(`<span class="merge-stat-chip">Planificadas: <strong>${formatNum(stats.mergesPlanned)}</strong></span>`);
    }
    if (stats.currentMerge != null && stats.totalMerges != null) {
      chips.push(`<span class="merge-stat-chip">Fusión: <strong>${stats.currentMerge}/${stats.totalMerges}</strong></span>`);
    }
    if (stats.mergesApplied != null && data.phase === 'done') {
      chips.push(`<span class="merge-stat-chip success">Aplicadas: <strong>${formatNum(stats.mergesApplied)}</strong></span>`);
    }
    if (stats.mergesFailed != null && data.phase === 'done') {
      chips.push(`<span class="merge-stat-chip ${stats.mergesFailed > 0 ? 'error' : ''}">Fallidas: <strong>${formatNum(stats.mergesFailed)}</strong></span>`);
    }

    if (chips.length) {
      document.getElementById('mergeProgressStats').innerHTML = chips.join('');
    }
  },

  /**
   * @param {Record<string, unknown>} data
   */
  onLog(data) {
    this.appendLog(String(data.message || ''), data.level || 'info');
  },

  /**
   * @param {object} result
   */
  onComplete(result) {
    const stats = result.stats || {};
    const statusEl = document.getElementById('mergeProgressStatus');
    const summaryEl = document.getElementById('mergeProgressSummary');

    document.getElementById('mergeProgressBar').style.width = '100%';
    document.getElementById('mergeProgressPercent').textContent = '100%';
    document.getElementById('mergeProgressEta').textContent = 'Completado';

    const failed = stats.mergesFailed || 0;
    const isApply = !result.dryRun;

    if (isApply && failed > 0) {
      statusEl.textContent = 'Finalizado con errores';
      statusEl.className = 'merge-progress-status warning';
    } else {
      statusEl.textContent = 'Finalizado';
      statusEl.className = 'merge-progress-status done';
    }

    let summaryHtml = '';
    if (result.dryRun) {
      summaryHtml = `
        <div class="merge-summary-grid">
          <div class="merge-summary-item"><span>Grupos detectados</span><strong>${formatNum(stats.mergeGroups)}</strong></div>
          <div class="merge-summary-item"><span>Fusiones planificadas</span><strong>${formatNum(stats.mergesPlanned)}</strong></div>
          <div class="merge-summary-item"><span>Registros analizados</span><strong>${formatNum(stats.totalRecords)}</strong></div>
        </div>`;
      this.appendLog(
        `Simulación completada: ${stats.mergeGroups} grupos, ${stats.mergesPlanned} fusiones planificadas`,
        'success',
      );
    } else if (result.retryMode || stats.retryMode) {
      summaryHtml = `
        <div class="merge-summary-grid">
          <div class="merge-summary-item success"><span>Reintentos aplicados</span><strong>${formatNum(stats.mergesApplied)}</strong></div>
          <div class="merge-summary-item error"><span>Siguen fallidas</span><strong>${formatNum(stats.mergesFailed)}</strong></div>
          <div class="merge-summary-item"><span>Omitidas</span><strong>${formatNum(stats.mergesSkipped)}</strong></div>
          <div class="merge-summary-item"><span>Total reintentadas</span><strong>${formatNum(stats.mergesPlanned)}</strong></div>
        </div>`;
      this.appendLog(
        `Reintento completado: ${stats.mergesApplied} aplicadas, ${stats.mergesFailed} fallidas`,
        stats.mergesFailed > 0 ? 'warning' : 'success',
      );
    } else {
      const applied = stats.mergesApplied || 0;
      const skipped = stats.mergesSkipped || 0;
      summaryHtml = `
        <div class="merge-summary-grid">
          <div class="merge-summary-item success"><span>Fusiones aplicadas</span><strong>${formatNum(applied)}</strong></div>
          <div class="merge-summary-item error"><span>Fusiones fallidas</span><strong>${formatNum(failed)}</strong></div>
          <div class="merge-summary-item"><span>Omitidas</span><strong>${formatNum(skipped)}</strong></div>
          <div class="merge-summary-item"><span>Grupos procesados</span><strong>${formatNum(stats.mergeGroups)}</strong></div>
        </div>`;
      this.appendLog(
        `Fusión completada: ${applied} aplicadas, ${failed} fallidas, ${skipped} omitidas`,
        failed > 0 ? 'warning' : 'success',
      );

      const failedResults = (result.results || []).filter((r) => r.status === 'failed');
      if (failedResults.length) {
        summaryHtml += '<div class="merge-failed-list"><h4>Detalle de fallos</h4>';
        summaryHtml += '<p class="merge-failed-hint">Los errores 500 suelen deberse a: saturación de la API (muchas fusiones seguidas), contactos ya fusionados en un intento anterior, workflows activos en el contacto secundario, o conflictos de datos en HubSpot. Tras reiniciar el servidor, vuelve a simular y aplica con filtros o solo los grupos pendientes.</p><ul>';
        for (const r of failedResults.slice(0, 30)) {
          const corr = r.correlationId ? ` <small>(${escapeHtml(r.correlationId)})</small>` : '';
          summaryHtml += `<li><code>${escapeHtml(r.mergeId)}</code> → ${escapeHtml(r.primaryId)}: ${escapeHtml(r.error || 'Error')}${corr}</li>`;
          this.appendLog(`✗ ${r.mergeId} → ${r.primaryId}: ${r.error || 'Error'}`, 'error');
        }
        if (failedResults.length > 30) {
          summaryHtml += `<li>… y ${failedResults.length - 30} más</li>`;
        }
        summaryHtml += '</ul></div>';
      }
    }

    summaryEl.innerHTML = summaryHtml;
    summaryEl.classList.remove('hidden');
    document.getElementById('mergeProgressMessage').textContent =
      result.dryRun
        ? 'Simulación finalizada correctamente'
        : failed > 0
          ? 'Proceso finalizado con algunos errores'
          : 'Todas las fusiones se aplicaron correctamente';
  },

  onError(message) {
    document.getElementById('mergeProgressStatus').textContent = 'Error';
    document.getElementById('mergeProgressStatus').className = 'merge-progress-status error';
    document.getElementById('mergeProgressMessage').textContent = message;
    this.appendLog(message, 'error');
  },

  /**
   * @param {string} message
   * @param {string} level
   * @param {number} [ts]
   */
  appendLog(message, level = 'info', ts) {
    if (!this.logEl || !message) return;
    const line = document.createElement('div');
    line.className = `merge-log-line merge-log-${level}`;
    const time = new Date(ts || Date.now()).toLocaleTimeString('es-ES');
    line.innerHTML = `<span class="merge-log-time">${time}</span>${escapeHtml(message)}`;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;

    while (this.logEl.children.length > this.maxLogLines) {
      this.logEl.removeChild(this.logEl.firstChild);
    }
  },
};

function formatNum(n) {
  if (n == null) return '-';
  return Number(n).toLocaleString('es-ES');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
