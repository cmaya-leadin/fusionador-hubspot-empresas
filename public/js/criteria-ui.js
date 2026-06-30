const PRIMARY_RULE_OPTIONS = [
  { type: 'property_filled', label: 'Propiedad informada', needsProperty: true, defaultProperty: '' },
  { type: 'max_associations', label: 'Mayor nº de asociaciones', needsProperty: true, defaultProperty: 'num_associated_contacts' },
  { type: 'most_recent', label: 'Datos más recientes', needsProperty: true, defaultProperty: 'hs_lastmodifieddate' },
  { type: 'oldest', label: 'Registro más antiguo', needsProperty: true, defaultProperty: 'createdate' },
  { type: 'max_filled_props', label: 'Más propiedades rellenas', needsProperty: false },
  { type: 'min_id', label: 'ID más bajo (desempate)', needsProperty: false },
];

const MATCH_PRESETS = {
  companies: [
    { label: 'Nombre', properties: ['name'] },
    { label: 'Dominio', properties: ['domain'] },
    { label: 'Nombre + Dominio', properties: ['name', 'domain'] },
    { label: 'Nombre + Email', properties: ['name', 'email'] },
    { label: 'CIF/VAT', properties: ['vat_number___cif'] },
  ],
  contacts: [
    { label: 'Nombre (solo compuesto)', properties: ['name'] },
    { label: 'Nombre + Teléfono (HubSpot)', properties: ['name', 'phone'] },
    { label: 'Nombre + Email', properties: ['name', 'email'] },
    { label: 'Email', properties: ['email'] },
    { label: 'Teléfono', properties: ['phone'] },
    { label: 'Nombre + Móvil', properties: ['name', 'mobilephone'] },
  ],
};

function describePrimaryRule(rule) {
  const opt = PRIMARY_RULE_OPTIONS.find((o) => o.type === rule.type);
  const label = opt?.label || rule.type;
  return rule.property ? `${label} → ${rule.property}` : label;
}

function renderCriteriaSummary(criteria, entityType) {
  const matchHtml = (criteria.matchRules || [])
    .map((r) => `<span class="badge badge-info">${escapeHtml(r.label || r.properties.join(' + '))}</span>`)
    .join(' ');

  const primaryHtml = (criteria.primaryRules || [])
    .map((r, i) => `<span class="criteria-order">${i + 1}.</span> ${escapeHtml(describePrimaryRule(r))}`)
    .join('<br>');

  const exclusions = [];
  if (criteria.skipInactive) exclusions.push('omitir inactivos');
  if (criteria.skipOnlyProveedor) exclusions.push('omitir solo proveedor');
  if (criteria.excludeGenericDomains !== false) exclusions.push('sin dominios genéricos');
  if ((criteria.minNameWords || 0) >= 2) {
    exclusions.push(`nombre ≥ ${criteria.minNameWords} palabras`);
  }

  const exclusionsHtml = exclusions.length
    ? `<p class="criteria-hint" style="margin-top:12px"><strong>Filtros:</strong> ${exclusions.map(escapeHtml).join(' · ')}</p>`
    : '';

  return `
    <div class="criteria-summary-grid">
      <div>
        <h4>Resumen — Coincidencia</h4>
        <div class="criteria-badges">${matchHtml || '<em>Sin reglas</em>'}</div>
      </div>
      <div>
        <h4>Resumen — Predominancia</h4>
        <div class="criteria-primary-list">${primaryHtml || '<em>Sin reglas</em>'}</div>
      </div>
    </div>
    ${exclusionsHtml}
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;');
}

function getCriteriaContainer() {
  return document.getElementById('criteriaEditor');
}

function createMatchRuleRow(rule = { label: '', properties: ['name'] }, entityType) {
  const row = document.createElement('div');
  row.className = 'criteria-rule-card match-rule-row';
  row.innerHTML = `
    <div class="criteria-field">
      <label class="criteria-field-label">Etiqueta</label>
      <input type="text" class="criteria-input match-label" placeholder="Ej. Nombre + Email" value="${escapeAttr(rule.label || '')}">
    </div>
    <div class="criteria-field criteria-field-grow">
      <label class="criteria-field-label">Propiedades HubSpot</label>
      <input type="text" class="criteria-input match-props" placeholder="name, email, phone…" value="${escapeAttr((rule.properties || []).join(', '))}">
      <span class="criteria-field-hint">Separadas por coma; todas deben coincidir</span>
    </div>
    <button type="button" class="btn btn-secondary btn-sm criteria-remove-btn remove-rule" title="Eliminar regla">✕</button>
  `;
  row.querySelector('.remove-rule').onclick = () => row.remove();
  return row;
}

function createPrimaryRuleRow(rule = { type: 'max_filled_props', property: '' }, index) {
  const row = document.createElement('div');
  row.className = 'criteria-rule-card primary-rule-row';
  const options = PRIMARY_RULE_OPTIONS.map(
    (o) => `<option value="${o.type}" ${o.type === rule.type ? 'selected' : ''}>${o.label}</option>`,
  ).join('');

  row.innerHTML = `
    <span class="criteria-order">${index + 1}</span>
    <div class="criteria-field criteria-field-grow">
      <label class="criteria-field-label">Criterio</label>
      <select class="criteria-input criteria-select primary-type">${options}</select>
    </div>
    <div class="criteria-field criteria-field-grow">
      <label class="criteria-field-label">Propiedad</label>
      <input type="text" class="criteria-input primary-prop" placeholder="Propiedad HubSpot" value="${escapeAttr(rule.property || '')}">
    </div>
    <div class="primary-actions">
      <button type="button" class="btn btn-secondary btn-sm move-up" title="Subir">↑</button>
      <button type="button" class="btn btn-secondary btn-sm move-down" title="Bajar">↓</button>
      <button type="button" class="btn btn-secondary btn-sm criteria-remove-btn remove-rule" title="Eliminar">✕</button>
    </div>
  `;

  const typeSelect = row.querySelector('.primary-type');
  const propInput = row.querySelector('.primary-prop');

  function syncPropertyField() {
    const opt = PRIMARY_RULE_OPTIONS.find((o) => o.type === typeSelect.value);
    propInput.style.display = opt?.needsProperty ? '' : 'none';
    if (opt?.needsProperty && !propInput.value && opt.defaultProperty) {
      propInput.placeholder = opt.defaultProperty;
    }
  }

  typeSelect.onchange = syncPropertyField;
  syncPropertyField();

  row.querySelector('.remove-rule').onclick = () => {
    row.remove();
    renumberPrimaryRules();
  };
  row.querySelector('.move-up').onclick = () => {
    const prev = row.previousElementSibling;
    if (prev) {
      row.parentNode.insertBefore(row, prev);
      renumberPrimaryRules();
    }
  };
  row.querySelector('.move-down').onclick = () => {
    const next = row.nextElementSibling;
    if (next) {
      row.parentNode.insertBefore(next, row);
      renumberPrimaryRules();
    }
  };

  return row;
}

function renumberPrimaryRules() {
  const editor = getCriteriaContainer();
  if (!editor) return;
  editor.querySelectorAll('#primaryRulesList .criteria-order').forEach((el, i) => {
    el.textContent = String(i + 1);
  });
}

function loadCriteriaForm(criteria, entityType) {
  const editor = getCriteriaContainer();
  if (!editor) return;

  const matchList = editor.querySelector('#matchRulesList');
  const primaryList = editor.querySelector('#primaryRulesList');
  matchList.innerHTML = '';
  primaryList.innerHTML = '';

  for (const rule of criteria.matchRules || []) {
    matchList.appendChild(createMatchRuleRow(rule, entityType));
  }

  (criteria.primaryRules || []).forEach((rule, i) => {
    primaryList.appendChild(createPrimaryRuleRow(rule, i));
  });

  editor.querySelector('#critSkipInactive').checked = !!criteria.skipInactive;
  editor.querySelector('#critSkipProveedor').checked = !!criteria.skipOnlyProveedor;
  editor.querySelector('#critExcludeGeneric').checked = criteria.excludeGenericDomains !== false;

  const minNameRow = editor.querySelector('#critMinNameWordsRow');
  const minNameCheck = editor.querySelector('#critMinNameWords');
  if (minNameRow && minNameCheck) {
    const isContacts = entityType === 'contacts';
    minNameRow.hidden = !isContacts;
    minNameCheck.checked = isContacts && (criteria.minNameWords || 0) >= 2;
  }

  updateCriteriaSummary(criteria, entityType);
  updateMatchPresets(entityType);
  setCriteriaStatus('');
}

function updateMatchPresets(entityType) {
  const editor = getCriteriaContainer();
  const select = editor?.querySelector('#matchPresetSelect');
  if (!select) return;
  const presets = MATCH_PRESETS[entityType] || MATCH_PRESETS.companies;
  select.innerHTML = '<option value="">Añadir regla predefinida…</option>' +
    presets.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
}

function readCriteriaForm(entityType) {
  const editor = getCriteriaContainer();
  if (!editor) {
    throw new Error('Editor de criterios no encontrado');
  }

  const matchRules = [...editor.querySelectorAll('#matchRulesList .match-rule-row')].map((row) => {
    const properties = row.querySelector('.match-props').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const label = row.querySelector('.match-label').value.trim() ||
      properties.join(' + ');
    return { properties, label };
  }).filter((r) => r.properties.length > 0);

  const primaryRules = [...editor.querySelectorAll('#primaryRulesList .primary-rule-row')].map((row) => {
    const type = row.querySelector('.primary-type').value;
    const opt = PRIMARY_RULE_OPTIONS.find((o) => o.type === type);
    const property = row.querySelector('.primary-prop').value.trim() ||
      (opt?.needsProperty ? opt.defaultProperty : undefined);
    const rule = { type };
    if (opt?.needsProperty && property) rule.property = property;
    return rule;
  });

  const minNameCheck = editor.querySelector('#critMinNameWords');
  const minNameWords =
    entityType === 'contacts' && minNameCheck?.checked ? 2 : 0;

  return {
    matchRules,
    primaryRules,
    skipInactive: editor.querySelector('#critSkipInactive').checked,
    skipOnlyProveedor: editor.querySelector('#critSkipProveedor').checked,
    excludeGenericDomains: editor.querySelector('#critExcludeGeneric').checked,
    minNameWords,
  };
}

function updateCriteriaSummary(criteria, entityType) {
  const el = document.getElementById('criteriaSummary');
  if (el) el.innerHTML = renderCriteriaSummary(criteria, entityType);
}

function setCriteriaStatus(message, isError = false) {
  const el = document.getElementById('criteriaSaveStatus');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'criteria-status error-msg' : 'criteria-status';
  if (message && !isError) {
    el.style.color = '#166534';
    el.style.background = '#dcfce7';
    el.style.padding = '8px 12px';
    el.style.borderRadius = '8px';
    el.style.marginTop = '12px';
  }
}

async function persistCriteria(projectId, entityType, extraData = {}) {
  const mergeCriteria = readCriteriaForm(entityType);

  if (!mergeCriteria.matchRules.length) {
    throw new Error('Añade al menos una regla de coincidencia');
  }
  if (!mergeCriteria.primaryRules.length) {
    throw new Error('Añade al menos una regla de predominancia');
  }

  const payload = { mergeCriteria };
  if (entityType) payload.entityType = entityType;
  if (extraData.name != null) payload.name = extraData.name;
  if (extraData.hubspotAccount != null) payload.hubspotAccount = extraData.hubspotAccount;
  if (extraData.hubspotToken) payload.hubspotToken = extraData.hubspotToken;

  const { project } = await API.updateProject(projectId, payload);

  updateCriteriaSummary(project.mergeCriteria, project.entityType);
  loadCriteriaForm(project.mergeCriteria, project.entityType);
  setCriteriaStatus(`Guardado correctamente (${new Date().toLocaleTimeString('es-ES')})`);
  return project;
}

function scrollToCriteria() {
  document.getElementById('criteriaPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupCriteriaEditor(project, projectId, onSaved) {
  const editor = getCriteriaContainer();
  if (!editor) return;

  editor.querySelector('#addMatchRuleBtn').onclick = () => {
    editor.querySelector('#matchRulesList').appendChild(
      createMatchRuleRow({ properties: ['name'], label: '' }, project.entityType),
    );
  };

  editor.querySelector('#addPrimaryRuleBtn').onclick = () => {
    const list = editor.querySelector('#primaryRulesList');
    list.appendChild(createPrimaryRuleRow({ type: 'max_filled_props' }, list.children.length));
  };

  editor.querySelector('#matchPresetSelect').onchange = (e) => {
    const idx = e.target.value;
    if (idx === '') return;
    const presets = MATCH_PRESETS[project.entityType] || MATCH_PRESETS.companies;
    const preset = presets[Number(idx)];
    if (preset) {
      editor.querySelector('#matchRulesList').appendChild(
        createMatchRuleRow(preset, project.entityType),
      );
      if (
        project.entityType === 'contacts' &&
        preset.properties?.length === 1 &&
        preset.properties[0] === 'name'
      ) {
        const minNameCheck = editor.querySelector('#critMinNameWords');
        if (minNameCheck) minNameCheck.checked = true;
      }
    }
    e.target.value = '';
  };

  document.getElementById('saveCriteriaPanelBtn').onclick = async () => {
    const btn = document.getElementById('saveCriteriaPanelBtn');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const updated = await persistCriteria(projectId, project.entityType);
      Object.assign(project, updated);
      onSaved?.();
    } catch (err) {
      setCriteriaStatus(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar criterios';
    }
  };
}
