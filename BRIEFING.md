# Briefing — HubSpot Grupos de Empresas

**Proyecto:** `hubspot-grupos-empresas`  
**Cliente / contexto:** AIMPLAS — CRM HubSpot con ~79.000 registros de empresa  
**Versión:** 1.0  
**Stack:** Node.js 18+, API REST HubSpot (sin exportar/importar CSV masivos de HubSpot)

---

## 1. Problema de negocio

En HubSpot conviven empresas que pertenecen al **mismo grupo corporativo** pero aparecen como registros separados porque:

- Tienen **nombres muy distintos** (filiales, marcas, personas, razones sociales locales).
- Usan **dominios diferentes** (`ravago.com`, `ravago.it`, `resinex.com`, etc.).
- A menudo faltan datos (VAT, teléfono, dirección).

Eso dificulta ver el grupo unificado, reportar correctamente y mantener el CRM ordenado.

## 2. Objetivo del proyecto

Automatizar, vía script:

1. **Detectar** qué empresas pertenecen al mismo grupo.
2. **Asociarlas** en HubSpot con la etiqueta personalizada **«Grupo Empresa»** (`grupo_empresa`, typeId `1`).
3. **Marcar** la propiedad **`pertenece_a_grupo_de_empresas`** = **Sí** (`true`).
4. **Registrar** metadatos de agrupación (clave de grupo, hub, confianza, estado de revisión).
5. Poder **revertir** un lote de cambios si la prueba o ejecución no es correcta.

Todo se hace por **API** (lectura y escritura directa). No requiere exportar las 79.000 empresas a Excel ni reimportarlas.

## 3. Qué hace el script (flujo general)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│  HubSpot API    │────▶│  Motor agrupación │────▶│  CSV previsualización   │
│  (79k empresas) │     │  (reglas en capas)│     │  grupos_propuestos.csv  │
└─────────────────┘     └────────┬─────────┘     └─────────────────────────┘
                                 │
                    --apply      ▼
                        ┌────────────────────┐
                        │ Actualizar props   │
                        │ Crear asociaciones │
                        │ CSV auditoría      │
                        └────────────────────┘
                                 │
                    --revert     ▼
                        ┌────────────────────┐
                        │ Quitar asociaciones│
                        │ Restaurar props    │
                        └────────────────────┘
```

### Modos de ejecución

| Modo | Comando | Efecto en HubSpot |
|------|---------|-------------------|
| **Dry-run** | `--dry-run` | Solo genera informes CSV. **No modifica nada.** |
| **Apply** | `--apply` | Escribe propiedades y crea asociaciones. |
| **Revert** | `--revert --from <csv>` | Deshace lo registrado en un CSV de auditoría. |

## 4. Cómo decide que dos empresas son del mismo grupo

El motor aplica reglas **en orden de prioridad** (de más fiable a más arriesgada):

| Prioridad | Mecanismo | Confianza | Descripción |
|-----------|-----------|-----------|-------------|
| 1 | **Override manual** | 90 | Archivo `grupos_manuales.csv` (`company_id`, `grupo_id`). |
| 2 | **Familia corporativa** | 95 | Archivo `corporativos.json` — excepciones donde el dominio no coincide (ej. `resinex.com` → grupo `ravago.com`). |
| 3 | **Dominio raíz** | 100 | Campo HubSpot `dominio_raiz` (configurable en `.env`). |
| 4 | **Auto multi-TLD** | 75 | Si la misma marca aparece en ≥2 TLD (`.it`, `.es`, `.com`…) y ≥2 empresas, unifica bajo `marca.com`. Reglas en `agrupacion.json`. |
| 5 | **Dominio exacto** | 100 | Mismo `domain` o dominio extraído de `email_de_empresa`. |
| — | **Bloqueados** | — | `gmail.com`, `live.com`, `hotmail.com`, etc. **nunca** generan grupo. |

**Clave de grupo (`group_key`):** identificador lógico compartido (normalmente un dominio canónico, ej. `ravago.com`).

**Empresa hub:** dentro de cada grupo, una empresa «principal» (prioridad: dominio preferido del grupo, ej. `ravago.com`; si no, la más antigua por `createdate`). El resto se asocian a ella en modelo **estrella** (no todas con todas).

## 5. Qué escribe en HubSpot al aplicar (`--apply`)

### Asociaciones

- Tipo: **Grupo Empresa** (`grupo_empresa`, categoría `USER_DEFINED`, id `1`).
- Modelo: **hub ↔ cada miembro** (una asociación por par).

### Propiedades de empresa (si existen en el portal)

| Propiedad (nombre por defecto) | Valor al aplicar | Uso |
|-------------------------------|------------------|-----|
| `pertenece_a_grupo_de_empresas` | `true` (Sí) | Indica que la empresa forma parte de un grupo. |
| `group_key` | ej. `ravago.com` | Clave lógica del grupo. |
| `group_confidence` | 75–100 | Según el tipo de regla que agrupó. |
| `group_review_status` | `APROBADO` | Estado de revisión (valores configurables en `.env`). |
| `grupo_empresa_principal_id` | ID del hub | Empresa principal del grupo. |
| `grupo_script_run_id` | **Opcional** | Solo si la propiedad existe y `HS_PROP_RUN_ID` está en `.env`. ID de ejecución para trazabilidad. |

Los nombres internos se pueden cambiar en `.env` (`HS_PROP_*`).

### Campos que lee (no modifica salvo agrupación)

`name`, `domain`, `dominio_raiz`, `email_de_empresa`, `vat_number___cif`, `phone`, `address`, `createdate`.

## 6. Archivos de salida (`output/`)

| Archivo | Cuándo | Contenido |
|---------|--------|-----------|
| `grupos_propuestos.csv` | `--dry-run` | Grupos detectados: IDs, dominios, hub, fuente de la regla (`key_source`). |
| `cambios_aplicados.csv` / `_prueba.csv` | `--apply` | Auditoría completa: valores antes/después, pares de asociación, `run_id`. |
| `asociaciones_prueba_run_*.csv` | `--apply` | Solo pares hub → miembro creados. |
| `revertido_*.csv` | `--revert` | Registro de la reversión. |

El **`run_id`** (ej. `run_1780045017485`) identifica cada ejecución en los CSV aunque no exista la propiedad opcional en HubSpot.

## 7. Seguridad y control de riesgo

- **`--apply` sin filtros está bloqueado** por defecto (evita tocar las ~79k empresas por accidente).
- Volcado completo solo con: `--apply --confirm-full-run`.
- **Filtros de prueba:** `--dominio`, `--nombre`, `--grupo`, `--ids`, `--max-grupos`.
- **`--min-confidence 90`:** excluye grupos basados solo en email (80) o auto multi-TLD (75).
- **`--revert`:** elimina asociaciones del CSV y restaura propiedades (p. ej. `pertenece` → No, estado → `PENDIENTE`).

## 8. Configuración del proyecto

| Archivo | Función |
|---------|---------|
| `.env` | `HUBSPOT_TOKEN` (Private App). Opcional: nombres de propiedades y valores de select. |
| `agrupacion.json` | Umbrales globales: longitud mínima de marca, TLDs mínimos, slugs bloqueados. |
| `corporativos.json` | Familias con dominios distintos (excepciones; no un registro por empresa). |
| `grupos_manuales.csv` | Overrides por `company_id` (opcional). |

### Requisitos HubSpot (Private App)

- Scopes: lectura/escritura de empresas y asociaciones entre empresas.
- Asociación personalizada **Grupo Empresa** ya creada en el portal.

## 9. Comandos habituales

```bash
cd hubspot-grupos-empresas
npm install

# Informe global conservador (recomendado primero)
npm run dry-run:seguro

# Prueba solo Ravago
npm run ravago:dry-run
npm run test:apply          # máx. 5 grupos con "ravago" en dominio

# Aplicar prueba Ravago (10 grupos)
node src/index.js --apply --nombre ravago --max-grupos 10

# Revertir la última prueba documentada
npm run revert:test

# Volcado masivo (solo tras validar CSV)
node src/index.js --apply --confirm-full-run --min-confidence 90
```

## 10. Limitaciones conocidas

- **No agrupa por nombre** en todo el portal (demasiados falsos positivos).
- **Auto multi-TLD** solo actúa si hay evidencia estadística (varias TLD / varias empresas con el mismo slug).
- **Familias con marcas distintas** (Resinex + Ravago) requieren entrada en `corporativos.json`.
- La lectura de ~79k empresas tarda varios minutos por ejecución.
- Las propiedades custom deben existir en HubSpot con los nombres internos configurados; las inexistentes deben omitirse en `.env`.

## 11. Estructura técnica (carpetas)

```
hubspot-grupos-empresas/
├── src/
│   ├── index.js       # CLI y orquestación
│   ├── hubspot.js     # Cliente API (listar, actualizar, asociar, archivar)
│   ├── grouping.js    # Construcción de grupos y elección de hub
│   ├── corporate.js   # Familias corporativas (corporativos.json)
│   ├── brand-key.js   # Auto agrupación multi-TLD
│   ├── domain.js      # Normalización de dominios y bloqueos
│   ├── filters.js     # Filtros CLI y confianza mínima
│   ├── audit.js       # Filas de auditoría y lógica de revert
│   ├── revert.js      # Reversión desde CSV
│   ├── config.js      # Nombres de propiedades y umbrales
│   └── csv.js         # Lectura/escritura CSV
├── output/            # Informes generados (no subir a git)
├── agrupacion.json
├── corporativos.json
├── .env
└── package.json
```

## 12. Resumen ejecutivo (una frase)

**Herramienta Node.js que lee todas las empresas de HubSpot, las agrupa por reglas de dominio/marca configurables, crea asociaciones «Grupo Empresa» en modelo estrella, marca «Pertenece a grupo de empresas = Sí», deja trazabilidad en CSV y permite deshacer cada ejecución.**

---

*Documento generado como briefing funcional del repositorio. Para detalle operativo actualizado, consultar también `README.md`.*
