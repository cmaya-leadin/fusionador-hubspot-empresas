/**
 * @typedef {Object} CliOptions
 * @property {boolean} dryRun
 * @property {boolean} apply
 * @property {boolean} revert
 * @property {boolean} help
 * @property {string | null} fromFile
 * @property {string | null} runId
 * @property {string | null} dominio
 * @property {string | null} nombre
 * @property {string | null} grupo
 * @property {string[]} companyIds
 * @property {number | null} maxGrupos
 * @property {number | null} minConfidence
 * @property {boolean} testMode
 */

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  const options = {
    dryRun: argv.includes('--dry-run'),
    apply: argv.includes('--apply'),
    revert: argv.includes('--revert'),
    help: argv.includes('--help') || argv.includes('-h'),
    fromFile: null,
    runId: null,
    dominio: null,
    nombre: null,
    grupo: null,
    companyIds: [],
    maxGrupos: null,
    minConfidence: null,
    testMode: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--dominio' || arg === '--filter-domain') {
      options.dominio = argv[++i]?.trim() || null;
      continue;
    }

    if (arg === '--nombre' || arg === '--filter-name') {
      options.nombre = argv[++i]?.trim() || null;
      continue;
    }

    if (arg === '--grupo' || arg === '--filter-group') {
      options.grupo = argv[++i]?.trim() || null;
      continue;
    }

    if (
      arg === '--company-ids' ||
      arg === '--ids' ||
      arg === '--company-id'
    ) {
      const raw = argv[++i] || '';
      options.companyIds = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === '--max-grupos' || arg === '--limit') {
      const n = Number(argv[++i]);
      options.maxGrupos = Number.isFinite(n) && n > 0 ? n : null;
      continue;
    }

    if (arg === '--from' || arg === '--audit') {
      options.fromFile = argv[++i]?.trim() || null;
      continue;
    }

    if (arg === '--run-id') {
      options.runId = argv[++i]?.trim() || null;
      continue;
    }

    if (arg === '--min-confidence') {
      const n = Number(argv[++i]);
      options.minConfidence = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  options.testMode = Boolean(
    options.dominio ||
      options.nombre ||
      options.grupo ||
      options.companyIds.length > 0 ||
      options.maxGrupos,
  );

  return options;
}

/**
 * @param {CliOptions} options
 */
export function describeFilters(options) {
  const parts = [];

  if (options.dominio) parts.push(`dominio contiene "${options.dominio}"`);
  if (options.nombre) parts.push(`nombre/dominio/email contiene "${options.nombre}"`);
  if (options.grupo) parts.push(`grupo contiene "${options.grupo}"`);
  if (options.companyIds.length) {
    parts.push(`incluye company_id: ${options.companyIds.join(', ')}`);
  }
  if (options.maxGrupos) parts.push(`máximo ${options.maxGrupos} grupos`);
  if (options.minConfidence) {
    parts.push(`confianza mínima ${options.minConfidence}`);
  }

  return parts.length ? parts.join(' · ') : 'ninguno';
}
