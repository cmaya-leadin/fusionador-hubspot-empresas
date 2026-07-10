/**
 * @param {(payload: Record<string, unknown>) => void} emit
 */
export function createPropertiesProgress(emit) {
  const startedAt = Date.now();

  /**
   * @param {Partial<{ message: string, percent: number, stats: Record<string, unknown> }>} patch
   */
  function push(patch) {
    const percent = Math.min(100, Math.max(0, patch.percent ?? 0));
    let etaSeconds = null;
    if (percent > 0 && percent < 100) {
      const elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed >= 1) {
        const total = elapsed / (percent / 100);
        etaSeconds = Math.max(0, Math.round(total - elapsed));
      }
    } else if (percent >= 100) {
      etaSeconds = 0;
    }

    emit({
      type: 'progress',
      phase: percent >= 100 ? 'done' : 'create',
      message: patch.message || '',
      percent,
      etaSeconds,
      stats: patch.stats || {},
    });
  }

  return {
    /**
     * @param {string} message
     * @param {'info' | 'success' | 'warning' | 'error'} [level]
     */
    log(message, level = 'info') {
      emit({ type: 'log', message, level, ts: Date.now() });
    },

    /**
     * @param {string} hsObjectType
     * @param {number} total
     */
    start(hsObjectType, total) {
      push({
        message: `Iniciando creación de ${total} propiedad${total === 1 ? '' : 'es'} en ${hsObjectType}…`,
        percent: 1,
        stats: { hsObjectType, total, created: 0, errors: 0, exists: 0, skipped: 0 },
      });
      this.log(`Objeto HubSpot: ${hsObjectType} · ${total} propiedades en cola`);
    },

    /**
     * @param {number} count
     */
    groupsStart(count) {
      push({
        message: `Preparando ${count} grupo${count === 1 ? '' : 's'} de propiedades…`,
        percent: 5,
        stats: { groupsTotal: count },
      });
    },

    /**
     * @param {string} label
     * @param {string} name
     */
    groupCreated(label, name) {
      this.log(`✓ Grupo creado: ${label} (${name})`, 'success');
    },

    /**
     * @param {string} label
     * @param {string} name
     */
    groupExists(label, name) {
      this.log(`○ Grupo existente: ${label} (${name})`, 'info');
    },

    /**
     * @param {string} label
     * @param {string} message
     */
    groupError(label, message) {
      this.log(`✗ Error en grupo "${label}": ${message}`, 'error');
    },

    /**
     * @param {string} name
     * @param {number} current
     * @param {number} total
     * @param {{ created: number, errors: number, exists: number, skipped: number }} counts
     */
    propertyStep(name, current, total, counts) {
      const base = 10;
      const span = 88;
      const percent = total > 0 ? base + Math.round((current / total) * span) : base;
      push({
        message: `Creando propiedad ${current}/${total}: ${name}`,
        percent,
        stats: {
          current,
          total,
          created: counts.created,
          errors: counts.errors,
          exists: counts.exists,
          skipped: counts.skipped,
          lastProperty: name,
        },
      });
    },

    /**
     * @param {string} name
     * @param {string} [groupName]
     */
    propertyCreated(name, groupName) {
      const suffix = groupName ? ` → grupo ${groupName}` : '';
      this.log(`✓ Creada: ${name}${suffix}`, 'success');
    },

    /**
     * @param {string} name
     * @param {string} reason
     */
    propertySkipped(name, reason) {
      this.log(`○ Omitida ${name}: ${reason}`, 'warning');
    },

    /**
     * @param {string} name
     * @param {string} reason
     */
    propertyError(name, reason) {
      this.log(`✗ Error en ${name}: ${reason}`, 'error');
    },

    /**
     * @param {{ created: number, errors: number, exists: number, skipped: number, total: number }} summary
     * @param {string} hsObjectType
     */
    done(summary, hsObjectType) {
      const message = `Completado: ${summary.created} creadas · ${summary.exists} ya existían · ${summary.errors} con error`;
      push({
        message,
        percent: 100,
        stats: { ...summary, hsObjectType },
      });
      this.log(message, summary.errors > 0 ? 'warning' : 'success');
    },

    /**
     * @param {string} message
     */
    fail(message) {
      push({ message, percent: 100, stats: {} });
      this.log(message, 'error');
    },
  };
}
