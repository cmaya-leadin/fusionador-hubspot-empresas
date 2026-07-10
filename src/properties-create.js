import {
  buildHubSpotPropertyPayload,
  ensurePropertyGroups,
  resolveGroupNameFromMap,
  isValidHubSpotGroupInternalName,
} from './properties-import.js';

/**
 * @param {import('./hubspot.js').HubSpotClient} client
 * @param {{
 *   hsObjectType: string,
 *   names: string[],
 *   importedRows: Array<Record<string, unknown>>,
 *   progress?: ReturnType<import('./properties-progress.js').createPropertiesProgress> | null,
 * }} params
 */
export async function executePropertiesCreate(client, params) {
  const { hsObjectType, names, importedRows, progress } = params;
  const rowsByName = new Map(importedRows.map((r) => [String(r.name || ''), r]));

  const propsData = await client.listProperties(hsObjectType);
  const existing = new Set(
    (propsData?.results || []).map((p) => String(p.name || '').toLowerCase()).filter(Boolean),
  );

  const pendingRows = names
    .map((name) => rowsByName.get(name))
    .filter((row) => row && row.valid !== false && !existing.has(String(row.name || '').toLowerCase()));

  const groupLabels = [...new Set(
    pendingRows.map((row) => String(row.group || '').trim()).filter(Boolean),
  )];

  progress?.start(hsObjectType, names.length);
  if (groupLabels.length) {
    progress?.groupsStart(groupLabels.length);
    progress?.log(`Sincronizando grupos: ${groupLabels.join(', ')}`);
  }

  const groupResults = await ensurePropertyGroups(client, hsObjectType, groupLabels);

  for (const g of groupResults.created || []) {
    progress?.groupCreated(g.label, g.name);
  }
  for (const g of groupResults.skipped || []) {
    progress?.groupExists(g.label, g.name);
  }
  for (const g of groupResults.errors || []) {
    progress?.groupError(g.label, g.error);
  }

  const knownGroupNames = groupResults.groupNames || new Set();
  const groupNameByLabel = groupResults.groupNameByLabel || {};

  const results = [];
  let created = 0;
  let errors = 0;
  let existsCount = 0;
  let skipped = 0;
  let step = 0;

  for (const name of names) {
    const row = rowsByName.get(name);
    if (!row) {
      skipped += 1;
      const reason = 'No está en la importación actual';
      results.push({ name, status: 'skipped', reason });
      progress?.propertySkipped(name, reason);
      continue;
    }
    if (existing.has(String(name).toLowerCase())) {
      existsCount += 1;
      const reason = 'Ya existe en la cuenta';
      results.push({ name, status: 'exists', reason });
      progress?.propertySkipped(name, reason);
      continue;
    }

    step += 1;
    progress?.propertyStep(name, step, pendingRows.length || names.length, {
      created,
      errors,
      exists: existsCount,
      skipped,
    });

    const groupLabel = String(row.group || '').trim();
    if (groupLabel) {
      const resolvedGroupName = resolveGroupNameFromMap(groupLabel, groupNameByLabel);
      if (!isValidHubSpotGroupInternalName(resolvedGroupName) || !knownGroupNames.has(resolvedGroupName)) {
        const groupError = groupResults.errors?.find((e) => e.label === groupLabel);
        const reason = groupError
          ? `Grupo no disponible (${groupLabel}): ${groupError.error}`
          : `El grupo "${groupLabel}" no existe en HubSpot (se esperaba "${resolvedGroupName}"). Revisa permisos del token para crear grupos de propiedades.`;
        errors += 1;
        results.push({ name, status: 'error', reason });
        progress?.propertyError(name, reason);
        continue;
      }
    }

    const built = buildHubSpotPropertyPayload(row, hsObjectType, { groupNameByLabel });
    if (!built.ok) {
      errors += 1;
      results.push({ name, status: 'error', reason: built.error });
      progress?.propertyError(name, built.error);
      continue;
    }

    try {
      await client.createProperty(hsObjectType, built.payload);
      created += 1;
      results.push({ name, status: 'created', groupName: built.payload.groupName });
      existing.add(String(name).toLowerCase());
      row.exists = true;
      progress?.propertyCreated(name, built.payload.groupName);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      errors += 1;
      results.push({ name, status: 'error', reason });
      progress?.propertyError(name, reason);
    }
  }

  const summary = {
    created,
    errors,
    exists: existsCount,
    skipped,
    total: names.length,
  };

  progress?.done(summary, hsObjectType);

  return {
    hsObjectType,
    groupResults,
    results,
    summary,
  };
}
