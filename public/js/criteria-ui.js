const PRIMARY_RULE_OPTIONS = [
  { type: 'property_filled', label: 'Propiedad informada', needsProperty: true, defaultProperty: '' },
  { type: 'max_associations', label: 'Mayor nº de asociaciones', needsProperty: true, defaultProperty: 'num_associated_contacts' },
  { type: 'most_recent', label: 'Datos más recientes', needsProperty: true, defaultProperty: 'hs_lastmodifieddate' },
  { type: 'oldest', label: 'Registro más antiguo', needsProperty: true, defaultProperty: 'createdate' },
  { type: 'max_filled_props', label: 'Más propiedades rellenas', needsProperty: false },
  { type: 'min_id', label: 'ID más bajo (desempate)', needsProperty: false },
];

const EXCLUSION_RULE_OPTIONS = [
  { type: 'inactive', label: 'Omitir registro inactivo', needsProperty: true, needsValue: true, defaultProperty: 'estado', defaultValue: 'inactive', entityTypes: ['companies'] },
  { type: 'only_proveedor', label: 'Omitir solo proveedor', entityTypes: ['companies'] },
  { type: 'generic_domains', label: 'Ignorar dominios genéricos al emparejar', entityTypes: ['companies', 'contacts'] },
  { type: 'min_name_words', label: 'Nombre con mínimo de palabras', needsMinWords: true, defaultMinWords: 2, entityTypes: ['contacts'] },
  { type: 'different_phones', label: 'No fusionar teléfonos distintos en el grupo', entityTypes: ['contacts'] },
  { type: 'different_property', label: 'No fusionar si propiedad distinta en el grupo', needsProperty: true, entityTypes: ['companies', 'contacts'] },
  { type: 'record_property_filled', label: 'Omitir registro con propiedad informada', needsProperty: true, entityTypes: ['companies', 'contacts'] },
  { type: 'record_property_empty', label: 'Omitir registro con propiedad vacía', needsProperty: true, entityTypes: ['companies', 'contacts'] },
  { type: 'record_property_equals', label: 'Omitir registro si propiedad = valor', needsProperty: true, needsValue: true, entityTypes: ['companies', 'contacts'] },
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

const EXCLUSION_PRESETS = {
  companies: [
    { type: 'inactive', property: 'estado', value: 'inactive' },
    { type: 'only_proveedor' },
    { type: 'generic_domains' },
    { type: 'record_property_filled', property: 'codigo_cuenta_nav' },
    { type: 'different_property', property: 'domain' },
  ],
  contacts: [
    { type: 'min_name_words', minWords: 2 },
    { type: 'different_phones' },
    { type: 'different_property', property: 'email' },
    { type: 'generic_domains' },
    { type: 'record_property_filled', property: 'hs_lead_status' },
    { type: 'record_property_empty', property: 'email' },
  ],
};

function exclusionOptionsForEntity(entityType) {
  return EXCLUSION_RULE_OPTIONS.filter(
    (o) => !o.entityTypes || o.entityTypes.includes(entityType),
  );
}

function describePrimaryRule(rule) {
  const opt = PRIMARY_RULE_OPTIONS.find((o) => o.type === rule.type);
  const label = opt?.label || rule.type;
  return rule.property ? `${label} → ${rule.property}` : label;
}

function describeExclusionRule(rule) {
  const opt = EXCLUSION_RULE_OPTIONS.find((o) => o.type === rule.type);
  const base = rule.label || opt?.label || rule.type;
  if (rule.type === 'min_name_words') {
    return `${base} (≥ ${rule.minWords ?? 2})`;
  }
  if (rule.type === 'record_property_equals' && rule.property) {
    return `${base}: ${rule.property} = ${rule.value ?? ''}`;
  }
  if (rule.type === 'inactive' && rule.property) {
    return `${base}: ${rule.property} = ${rule.value ?? 'inactive'}`;
  }
  if (rule.property && rule.type !== 'different_phones') {
    return `${base} (${rule.property})`;
  }
  return base;
}

function renderCriteriaSummary(criteria, entityType) {
  const matchHtml = (criteria.matchRules || [])
    .map((r) => `<span class="badge badge-info">${escapeHtml(r.label || r.properties.join(' + '))}</span>`)
    .join(' ');

  const primaryHtml = (criteria.primaryRules || [])
    .map((r, i) => `<span class="criteria-order">${i + 1}.</span> ${escapeHtml(describePrimaryRule(r))}`)
    .join('<br>');

  const exclusionHtml = (criteria.exclusionRules || [])
    .map((r) => `<span class="badge badge-warn">${escapeHtml(describeExclusionRule(r))}</span>`)
    .join(' ');

  return `
    <div class="criteria-summary-grid criteria-summary-grid-3">
      <div>
        <h4>Resumen — Coincidencia</h4>
        <div class="criteria-badges">${matchHtml || '<em>Sin reglas</em>'}</div>
      </div>
      <div>
        <h4>Resumen — Predominancia</h4>
        <div class="criteria-primary-list">${primaryHtml || '<em>Sin reglas</em>'}</div>
      </div>
      <div>
        <h4>Resumen — Exclusiones</h4>
        <div class="criteria-badges">${exclusionHtml || '<em>Sin reglas</em>'}</div>
      </div>
    </div>
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

function createExclusionRuleRow(rule = { type: 'generic_domains' }, entityType) {
  const row = document.createElement('div');
  row.className = 'criteria-rule-card exclusion-rule-row';
  const options = exclusionOptionsForEntity(entityType);
  const type = rule.type || options[0]?.type || 'generic_domains';
  const optionsHtml = options.map(
    (o) => `<option value="${o.type}" ${o.type === type ? 'selected' : ''}>${o.label}</option>`,
  ).join('');

  row.innerHTML = `
    <div class="criteria-field criteria-field-grow">
      <label class="criteria-field-label">Tipo de exclusión</label>
      <select class="criteria-input criteria-select exclusion-type">${optionsHtml}</select>
    </div>
    <div class="criteria-field exclusion-prop-field" style="display:none">
      <label class="criteria-field-label">Propiedad</label>
      <input type="text" class="criteria-input exclusion-prop" placeholder="email, phone, estado…" value="${escapeAttr(rule.property || '')}">
    </div>
    <div class="criteria-field exclusion-value-field" style="display:none">
      <label class="criteria-field-label">Valor</label>
      <input type="text" class="criteria-input exclusion-value" placeholder="Valor a excluir" value="${escapeAttr(rule.value || '')}">
    </div>
    <div class="criteria-field exclusion-minwords-field" style="display:none">
      <label class="criteria-field-label">Mín. palabras</label>
      <input type="number" class="criteria-input exclusion-minwords" min="2" max="10" value="${escapeAttr(String(rule.minWords ?? 2))}">
    </div>
    <button type="button" class="btn btn-secondary btn-sm criteria-remove-btn remove-rule" title="Eliminar regla">✕</button>
  `;

  const typeSelect = row.querySelector('.exclusion-type');
  const propField = row.querySelector('.exclusion-prop-field');
  const valueField = row.querySelector('.exclusion-value-field');
  const minWordsField = row.querySelector('.exclusion-minwords-field');
  const propInput = row.querySelector('.exclusion-prop');
  const valueInput = row.querySelector('.exclusion-value');

  function syncFields() {
    const opt = EXCLUSION_RULE_OPTIONS.find((o) => o.type === typeSelect.value);
    propField.style.display = opt?.needsProperty ? '' : 'none';
    valueField.style.display = opt?.needsValue ? '' : 'none';
    minWordsField.style.display = opt?.needsMinWords ? '' : 'none';
    if (opt?.needsProperty && !propInput.value && opt.defaultProperty) {
      propInput.placeholder = opt.defaultProperty;
    }
    if (opt?.needsValue && !valueInput.value && opt.defaultValue) {
      valueInput.placeholder = opt.defaultValue;
    }
  }

  typeSelect.onchange = syncFields;
  syncFields();
  row.querySelector('.remove-rule').onclick = () => row.remove();
  return row;
}

function renumberPrimaryRules() {
  const editor = getCriteriaContainer();
  if (!editor) return;
  editor.querySelectorAll('#primaryRulesList .criteria-order').forEach((el, i) => {
    el.textContent = String(i + 1);
  });
}

function appendExclusionRule(editor, rule, entityType) {
  editor.querySelector('#exclusionRulesList').appendChild(
    createExclusionRuleRow(rule, entityType),
  );
}

function hasExclusionRuleType(editor, type) {
  return [...editor.querySelectorAll('#exclusionRulesList .exclusion-rule-row')].some(
    (row) => row.querySelector('.exclusion-type').value === type,
  );
}

function addDefaultContactExclusions(editor) {
  if (!hasExclusionRuleType(editor, 'min_name_words')) {
    appendExclusionRule(editor, { type: 'min_name_words', minWords: 2 }, 'contacts');
  }
  if (!hasExclusionRuleType(editor, 'different_phones')) {
    appendExclusionRule(editor, { type: 'different_phones' }, 'contacts');
  }
}

function loadCriteriaForm(criteria, entityType) {
  const editor = getCriteriaContainer();
  if (!editor) return;

  const matchList = editor.querySelector('#matchRulesList');
  const primaryList = editor.querySelector('#primaryRulesList');
  const exclusionList = editor.querySelector('#exclusionRulesList');
  matchList.innerHTML = '';
  primaryList.innerHTML = '';
  exclusionList.innerHTML = '';

  for (const rule of criteria.matchRules || []) {
    matchList.appendChild(createMatchRuleRow(rule, entityType));
  }

  (criteria.primaryRules || []).forEach((rule, i) => {
    primaryList.appendChild(createPrimaryRuleRow(rule, i));
  });

  for (const rule of criteria.exclusionRules || []) {
    exclusionList.appendChild(createExclusionRuleRow(rule, entityType));
  }

  updateCriteriaSummary(criteria, entityType);
  updateMatchPresets(entityType);
  updateExclusionPresets(entityType);
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

function updateExclusionPresets(entityType) {
  const editor = getCriteriaContainer();
  const select = editor?.querySelector('#exclusionPresetSelect');
  if (!select) return;
  const presets = EXCLUSION_PRESETS[entityType] || EXCLUSION_PRESETS.companies;
  select.innerHTML = '<option value="">Añadir exclusión predefinida…</option>' +
    presets.map((p, i) => `<option value="${i}">${escapeHtml(describeExclusionRule(p))}</option>`).join('');
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

  const exclusionRules = [...editor.querySelectorAll('#exclusionRulesList .exclusion-rule-row')].map((row) => {
    const type = row.querySelector('.exclusion-type').value;
    const opt = EXCLUSION_RULE_OPTIONS.find((o) => o.type === type);
    const rule = { type };
    if (opt?.needsProperty) {
      const property = row.querySelector('.exclusion-prop').value.trim() || opt.defaultProperty;
      if (property) rule.property = property;
    }
    if (opt?.needsValue) {
      const value = row.querySelector('.exclusion-value').value.trim() || opt.defaultValue;
      if (value != null) rule.value = value;
    }
    if (opt?.needsMinWords) {
      const minWords = Number(row.querySelector('.exclusion-minwords').value);
      rule.minWords = Number.isFinite(minWords) && minWords >= 2 ? Math.floor(minWords) : 2;
    }
    if (type === 'different_phones') rule.requiresNameMatch = true;
    return rule;
  });

  return { matchRules, primaryRules, exclusionRules };
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

  editor.querySelector('#addExclusionRuleBtn').onclick = () => {
    const defaults = exclusionOptionsForEntity(project.entityType);
    appendExclusionRule(editor, { type: defaults[0]?.type || 'generic_domains' }, project.entityType);
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
        addDefaultContactExclusions(editor);
      }
    }
    e.target.value = '';
  };

  editor.querySelector('#exclusionPresetSelect').onchange = (e) => {
    const idx = e.target.value;
    if (idx === '') return;
    const presets = EXCLUSION_PRESETS[project.entityType] || EXCLUSION_PRESETS.companies;
    const preset = presets[Number(idx)];
    if (preset) appendExclusionRule(editor, preset, project.entityType);
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
