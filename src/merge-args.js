/**
 * @typedef {Object} MergeCliOptions
 * @property {boolean} dryRun
 * @property {boolean} apply
 * @property {boolean} help
 * @property {string | null} dominio
 * @property {string | null} nombre
 * @property {string[]} companyIds
 * @property {number | null} maxGrupos
 * @property {boolean} confirmFullRun
 * @property {boolean} testMode
 */

/**
 * @param {string[]} argv
 * @returns {MergeCliOptions}
 */
export function parseMergeArgs(argv) {
  const options = {
    dryRun: argv.includes('--dry-run'),
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
    dominio: null,
    nombre: null,
    companyIds: [],
    maxGrupos: null,
    confirmFullRun: argv.includes('--confirm-full-run'),
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

    if (
      arg === '--company-ids' ||
      arg === '--ids' ||
      arg === '--company-id'
    ) {
      const raw = argv[++i] || '';
      options.companyIds = raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === '--max-grupos' || arg === '--max-groups' || arg === '--limit') {
      const n = Number(argv[++i]);
      options.maxGrupos = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  options.testMode = Boolean(
    options.dominio ||
      options.nombre ||
      options.companyIds.length > 0 ||
      options.maxGrupos,
  );

  return options;
}

/**
 * @param {MergeCliOptions} options
 */
export function describeMergeFilters(options) {
  const parts = [];

  if (options.dominio) parts.push(`dominio contiene "${options.dominio}"`);
  if (options.nombre) parts.push(`nombre/dominio contiene "${options.nombre}"`);
  if (options.companyIds.length) {
    parts.push(`incluye company_id: ${options.companyIds.join(', ')}`);
  }
  if (options.maxGrupos) parts.push(`máximo ${options.maxGrupos} grupos`);

  return parts.length ? parts.join(' · ') : 'ninguno';
}

/**
 * @param {MergeCliOptions} cli
 * @returns {import('./merge.js').MergeOptions}
 */
export function cliToMergeOptions(cli) {
  return {
    dryRun: !cli.apply,
    dominio: cli.dominio,
    nombre: cli.nombre,
    companyIds: cli.companyIds,
    maxGroups: cli.maxGrupos,
    confirmFullRun: cli.confirmFullRun,
  };
}
