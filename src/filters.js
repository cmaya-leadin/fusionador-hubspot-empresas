import { confidenceForSource } from './config.js';

/**
 * @typedef {import('./grouping.js').CompanyGroup} CompanyGroup
 * @typedef {import('./args.js').CliOptions} CliOptions
 */

/**
 * @param {string | null | undefined} haystack
 * @param {string} needle
 */
function containsIgnoreCase(haystack, needle) {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * @param {CompanyGroup} group
 * @param {string} text
 */
function groupMatchesNombre(group, text) {
  return group.companies.some((c) => {
    const props = c.properties;
    return (
      containsIgnoreCase(c.name, text) ||
      containsIgnoreCase(props.domain, text) ||
      containsIgnoreCase(props.email_de_empresa, text)
    );
  });
}

/**
 * @param {CompanyGroup[]} groups
 * @param {CliOptions} options
 * @param {Map<string, string>} [manualGroupByCompanyId]
 */
export function filterGroups(groups, options, manualGroupByCompanyId = new Map()) {
  let filtered = groups;

  if (options.dominio) {
    filtered = filtered.filter((g) =>
      containsIgnoreCase(g.groupKey, options.dominio),
    );
  }

  if (options.grupo) {
    filtered = filtered.filter((g) => {
      if (containsIgnoreCase(g.groupKey, options.grupo)) return true;
      if (containsIgnoreCase(g.familyId, options.grupo)) return true;
      return g.companies.some((c) =>
        containsIgnoreCase(manualGroupByCompanyId.get(c.id), options.grupo),
      );
    });
  }

  if (options.nombre) {
    filtered = filtered.filter((g) => groupMatchesNombre(g, options.nombre));
  }

  if (options.companyIds.length > 0) {
    const idSet = new Set(options.companyIds);
    filtered = filtered.filter((g) =>
      g.memberIds.some((id) => idSet.has(id)),
    );
  }

  if (options.maxGrupos != null && filtered.length > options.maxGrupos) {
    filtered = filtered.slice(0, options.maxGrupos);
  }

  return filtered;
}

/**
 * Excluye grupos donde alguna empresa no alcanza la confianza mínima.
 * @param {CompanyGroup[]} groups
 * @param {number | null} minConfidence
 */
export function filterGroupsByMinConfidence(groups, minConfidence) {
  if (!minConfidence) return groups;

  return groups.filter((g) =>
    g.companies.every(
      (c) => confidenceForSource(/** @type {*} */ (c.source)) >= minConfidence,
    ),
  );
}
