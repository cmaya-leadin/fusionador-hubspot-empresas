# Documentación completa — HubSpot Grupos de Empresas

**Proyecto:** hubspot-grupos-empresas  
**Ubicación:** `c:\Proyectos\AIMPLAS\hubspot-grupos-empresas`  
**Versión:** 1.0  
**Tecnología:** Node.js 18+, API REST HubSpot (Private App)  
**Escala:** ~79.000 empresas en el portal CRM  

---

## Índice

1. Resumen ejecutivo  
2. Contexto y problema de negocio  
3. Objetivos y alcance  
4. Qué NO hace el proyecto  
5. Arquitectura y flujo de datos  
6. Motor de agrupación (reglas en detalle)  
7. Modelo de asociaciones en HubSpot  
8. Propiedades de HubSpot (lectura y escritura)  
9. Archivos de configuración  
10. Modos de ejecución y línea de comandos  
11. Scripts npm  
12. Archivos de salida (CSV)  
13. Auditoría y reversión de cambios  
14. Variables de entorno (.env)  
15. Requisitos en HubSpot  
16. Instalación  
17. Guía de uso por fases  
18. Ejemplos reales (Ravago)  
19. Niveles de confianza  
20. Estructura del código fuente  
21. API de HubSpot utilizada  
22. Limitaciones y riesgos  
23. Mantenimiento y ampliación  
24. Glosario  
25. Preguntas frecuentes  

---

## 1. Resumen ejecutivo

Este proyecto es una **herramienta de línea de comandos** que se conecta a HubSpot por API, analiza todas las empresas del CRM y **detecta grupos corporativos** a partir principalmente del **dominio web** y reglas configurables. Para cada grupo válido (mínimo 2 empresas):

- Crea **asociaciones** entre empresas con la etiqueta personalizada **«Grupo Empresa»** (`grupo_empresa`).
- Marca la propiedad **`pertenece_a_grupo_de_empresas`** en **Sí**.
- Rellena propiedades auxiliares de trazabilidad (`group_key`, confianza, empresa hub, estado de revisión).
- Genera **informes CSV** para revisión humana antes y después de aplicar cambios.
- Permite **revertir** una ejecución concreta usando el CSV de auditoría.

No sustituye el juicio humano en casos ambiguos: está diseñado para **minimizar errores** con dry-run, filtros, umbrales de confianza y reversión.

---

## 2. Contexto y problema de negocio

### Situación inicial

En HubSpot hay decenas de miles de registros de tipo **Empresa**. Muchos corresponden a la misma organización (matriz, filiales, marcas, oficinas país) pero aparecen como registros independientes porque:

- El **nombre** varía mucho (razón social local, siglas, personas, dominio como nombre).
- El **dominio** varía (`empresa.com`, `empresa.it`, `marca-distinta.com`).
- Campos como VAT, teléfono o dirección están **poco completados**.
- Una búsqueda por texto (ej. «ravago») devuelve resultados heterogéneos difíciles de unificar a mano.

### Necesidad

- Ver en CRM qué empresas forman parte del **mismo grupo**.
- Poder **asociarlas** de forma explícita en HubSpot.
- Saber de un vistazo si una empresa **pertenece a un grupo** (propiedad booleana/select).
- Poder **deshacer** cambios masivos si una prueba falla.

### Enfoque elegido

Automatización por **script + API**, sin exportar/importar todo el objeto Empresa desde la interfaz de HubSpot.

---

## 3. Objetivos y alcance

### Objetivos

| # | Objetivo |
|---|----------|
| O1 | Agrupar empresas que comparten identidad corporativa (dominio / familia / override manual). |
| O2 | Crear asociaciones **Grupo Empresa** en modelo **estrella** (una empresa principal ↔ resto). |
| O3 | Actualizar `pertenece_a_grupo_de_empresas = Sí` en miembros del grupo. |
| O4 | Dejar trazabilidad en CSV y propiedades custom. |
| O5 | Permitir pruebas acotadas y reversión. |

### Alcance incluido

- Lectura paginada de todas las empresas.
- Agrupación automática multi-TLD para miles de marcas sin configurar una a una.
- Excepciones corporativas en JSON (ej. Ravago / Resinex).
- Overrides por ID en CSV.
- Dry-run, apply, revert.
- Filtros CLI para pruebas.

### Alcance excluido

- No modifica contactos, deals ni otros objetos.
- No deduplica ni fusiona registros (no hace merge de empresas).
- No agrupa por similitud de nombre en todo el portal.
- No garantiza verdad legal/sociedad: es una **heurística de dominio/marca**.

---

## 4. Qué NO hace el proyecto

- **No exporta** las 79.000 empresas a Excel para procesarlas fuera (salvo que el propio script genere CSV de informe).
- **No importa** CSV de vuelta a HubSpot para actualizar empresas (escribe por API).
- **No crea** empresas nuevas ni las elimina.
- **No asocia** todas las empresas de un grupo entre sí (n²): solo **hub ↔ cada miembro**.
- **No agrupa** cuentas con email `@gmail.com`, `@live.com`, etc.
- **No une** automáticamente dos dominios distintos salvo regla corporativa explícita o auto multi-TLD con evidencia estadística.

---

## 5. Arquitectura y flujo de datos

### Diagrama lógico

```
                    ┌─────────────────────────────────────┐
                    │           HubSpot CRM              │
                    │  Objeto: Empresa (~79 000)         │
                    │  Asociación: Grupo Empresa (custom)│
                    └──────────────┬──────────────────────┘
                                   │
                          GET /crm/v3/objects/companies
                          (paginado, 100 por página)
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │         mapCompanies()                │
                    │  resolveGroupKey() por empresa        │
                    └──────────────┬──────────────────────┘
                                   │
                          buildBrandRegistry()  ← scan global dominios
                          buildGroups()         ← buckets por group_key
                                   │
                    ┌──────────────┴──────────────────────┐
                    │                                     │
              --dry-run                              --apply
                    │                                     │
                    ▼                                     ▼
         grupos_propuestos.csv              batch/update propiedades
         (revisión humana)                 batch/create asociaciones
                                           cambios_aplicados.csv
                                                    │
                                              --revert --from csv
                                                    │
                                                    ▼
                                           batch/labels/archive asoc.
                                           batch/update restaurar props
```

### Tiempo de ejecución

- Leer ~79.000 empresas: **varios minutos** (depende de límites API y red).
- Apply/revert sobre subconjuntos: segundos o pocos minutos.

---

## 6. Motor de agrupación (reglas en detalle)

Cada empresa recibe un **`group_key`** (clave de grupo). Solo entran en un grupo si comparten la misma clave y hay **al menos 2 empresas** con esa clave.

### Orden de prioridad al calcular group_key

| Orden | Fuente (`key_source`) | Confianza | Descripción |
|-------|------------------------|-----------|-------------|
| 1 | `manual` | 90 | Entrada en `grupos_manuales.csv`: `company_id,grupo_id`. El `grupo_id` puede ser `ravago` o `ravago.com`; se resuelve a clave canónica si hay familia en corporativos.json. |
| 2 | `corporate` | 95 | Dominio listado en `corporativos.json` o coincidencia con `brandSlugs` de una familia. Unifica bajo `canonicalKey` (ej. `ravago.com`). |
| 3 | `root_domain` | 100 | Campo HubSpot `dominio_raiz` (nombre configurable con `HS_PROP_ROOT_DOMAIN`). |
| 4 | `brand_multi_tld` | 75 | Regla automática: misma marca en ≥2 TLD distintos y ≥2 empresas en el portal (ver `agrupacion.json`). |
| 5 | `domain` | 100 | Campo `domain` de la empresa (normalizado). |
| 6 | `email_de_empresa` | 80 | Dominio extraído del email si no hay dominio web útil. |
| — | `sin_clave` | — | Sin group_key: la empresa no entra en ningún grupo. |

### Normalización de dominio

Antes de comparar, los dominios se normalizan:

- Minúsculas.
- Sin `https://`, sin `www.`.
- Sin ruta, query ni puerto.

Ejemplo: `https://www.Ravago.IT/path` → `ravago.it`

### Dominios bloqueados (nunca agrupan)

Incluye proveedores de correo genérico: `gmail.com`, `live.com`, `hotmail.com`, `outlook.com`, `yahoo.com`, etc.

También slugs bloqueados en `agrupacion.json`: `group`, `mail`, `services`, `gmbh`, etc.

**Motivo:** evitar falsos grupos (ej. 9 empresas distintas con `@live.com` agrupadas por error).

### Regla auto multi-TLD (`brand-key.js` + `agrupacion.json`)

**Fase 1 — Análisis global:** se recorren todos los dominios del portal y se extrae un **slug de marca** (parte principal del dominio).

Ejemplos:

- `ravago.it` → slug `ravago`, TLD `it`
- `ravago.com` → slug `ravago`, TLD `com`
- `manufacturing.ravago.com` → slug `ravago` (subdominio bajo marca)

**Fase 2 — Activación:** el slug solo se activa para unificar si:

- `minDistinctTlds` ≥ 2 (por defecto 2 TLD distintos), **y**
- `minCompaniesWithSlug` ≥ 2 (por defecto 2 empresas), **y**
- longitud del slug ≥ `minSlugLength` (por defecto 4), **y**
- el slug no está en `blockedSlugs`.

**Clave canónica:** por defecto `slug.com` si existe en los datos; si no, el dominio más representativo del conjunto.

**Efecto:** `ravago.it`, `ravago.es`, `ravago.be` → mismo `group_key`: `ravago.com` **sin** listar cada TLD en JSON.

**No activa** unión para `solo.com` si solo hay una empresa y un TLD (evita inventar grupos).

### Familias corporativas (`corporativos.json`)

Para casos donde **el dominio no comparte slug** pero sí el grupo (marcas hermanas, adquisiciones):

```json
{
  "id": "ravago",
  "canonicalKey": "ravago.com",
  "preferHubDomain": "ravago.com",
  "domains": ["resinex.com", "cyjsa.com", ...]
}
```

- `canonicalKey`: valor de `group_key` para todas las empresas de la familia.
- `preferHubDomain`: dominio de la empresa que debe ser **hub** (ej. coordinación en `ravago.com`).
- `domains`: lista explícita de dominios que pertenecen a la familia.
- `brandSlugs`: patrones opcionales (en Ravago actual está vacío porque auto multi-TLD cubre `ravago.*`).

**Importante:** no hace falta una entrada por cada una de las 79.000 empresas; solo **excepciones** que la regla automática no detecta.

### Elección de la empresa HUB

Dentro de cada grupo:

1. Si hay `preferHubDomain` (familia corporativa o auto): empresa cuyo `domain` o `dominio_raiz` coincide.
2. Si el nombre sugiere sede central (coordination, centro, etc.) y dominio ravago.com.
3. Si no: empresa con **`createdate`** más antigua (desempate por ID).

El hub es el origen de las asociaciones en modelo estrella.

### Tamaño mínimo del grupo

Solo se procesan grupos con **≥ 2 empresas**. Una empresa aislada con dominio único no recibe asociaciones ni marca de grupo.

---

## 7. Modelo de asociaciones en HubSpot

### Tipo de asociación

| Campo | Valor |
|-------|--------|
| Etiqueta (UI) | Grupo Empresa |
| Nombre interno | `grupo_empresa` |
| Categoría | `USER_DEFINED` |
| associationTypeId | `1` |

(Configurado en `src/hubspot.js` como `GRUPO_EMPRESA_ASSOCIATION`.)

### Modelo estrella

Para un grupo de N empresas:

- Se crean **N − 1** asociaciones (no N×(N−1)/2).
- Cada asociación: **hub_id** → **company_id** de cada miembro no hub.

Ejemplo grupo Ravago con hub `49437319824` y 3 filiales:

```
49437319824  ──Grupo Empresa──►  empresa_it
49437319824  ──Grupo Empresa──►  empresa_es
49437319824  ──Grupo Empresa──►  empresa_be
```

### Creación y eliminación vía API

- **Crear:** `POST /crm/v4/associations/companies/companies/batch/create`
- **Eliminar (revert):** `POST /crm/v4/associations/companies/companies/batch/labels/archive`  
  (necesario para asociaciones con etiqueta personalizada; el endpoint genérico `/batch/archive` no vale para USER_DEFINED).

---

## 8. Propiedades de HubSpot (lectura y escritura)

### Propiedades que el script LEE

| Propiedad HubSpot | Uso en agrupación |
|-------------------|-------------------|
| `name` | Filtros `--nombre`; nombre en CSV; hub por nombre en casos corporativos. |
| `domain` | Principal fuente de group_key. |
| `dominio_raiz` | Normalización (configurable `HS_PROP_ROOT_DOMAIN`). |
| `email_de_empresa` | Dominio secundario si falta `domain`. |
| `vat_number___cif` | Leída; no usada en lógica actual (reserva futura). |
| `phone` | Leída; no usada en lógica actual. |
| `address` | Leída; no usada en lógica actual. |
| `createdate` | Desempate y elección de hub. |
| Propiedades de grupo ya existentes | Para auditoría «antes/después». |

### Propiedades que el script ESCRIBE (en --apply)

| Propiedad (nombre por defecto) | Tipo esperado | Valor al aplicar |
|-------------------------------|---------------|------------------|
| `pertenece_a_grupo_de_empresas` | Radio / boolean | `true` (= Sí en UI) |
| `group_key` | Texto | Clave del grupo, ej. `ravago.com` |
| `group_confidence` | Número | 75–100 según `key_source` |
| `group_review_status` | Select | `APROBADO` (interno; configurable) |
| `grupo_empresa_principal_id` | Texto | ID numérico del hub en HubSpot |
| `grupo_script_run_id` | Texto | **Opcional.** Solo si existe en portal y `HS_PROP_RUN_ID` en `.env` |

### Valores de confianza (`group_confidence`)

| key_source | Puntuación |
|------------|------------|
| domain, root_domain | 100 |
| corporate | 95 |
| manual | 90 |
| email_de_empresa | 80 |
| brand_multi_tld | 75 |
| sin_clave | 50 (no se aplica) |

### Propiedad `grupo_script_run_id` (opcional)

- **Qué es:** identificador de la ejecución del script (ej. `run_1780045017485`).
- **Para qué sirve:** filtrar en HubSpot qué empresas tocó un run; revertir por `--run-id`.
- **Si no existe en HubSpot:** el script **no la envía**; el `run_id` sigue en los CSV de auditoría.

### Valores al revertir

| Propiedad | Valor tras --revert |
|-----------|---------------------|
| `pertenece_a_grupo_de_empresas` | Valor anterior (`pertenece_antes` en CSV) o `false` si estaba vacío |
| `group_review_status` | `PENDIENTE` (no usar `REVERTIDO` salvo que exista en el select del portal) |
| `group_key`, `hub`, `confidence` | Vacíos o valor anterior si constaba en auditoría |

---

## 9. Archivos de configuración

### `.env` (obligatorio y opcional)

| Variable | Obligatorio | Descripción |
|----------|-------------|-------------|
| `HUBSPOT_TOKEN` | **Sí** | Token Private App (`pat-na1-...`). No subir a repositorio. |
| `HS_PROP_ROOT_DOMAIN` | No | Nombre interno del campo Dominio raíz (default: `dominio_raiz`). |
| `HS_PROP_GRUPO` | No | Default: `pertenece_a_grupo_de_empresas` |
| `HS_PROP_GROUP_KEY` | No | Default: `group_key` |
| `HS_PROP_GROUP_CONFIDENCE` | No | Default: `group_confidence` |
| `HS_PROP_GROUP_REVIEW_STATUS` | No | Default: `group_review_status` |
| `HS_PROP_HUB_ID` | No | Default: `grupo_empresa_principal_id` |
| `HS_PROP_RUN_ID` | No | Si se define, escribe esa propiedad con el run_id. |
| `HS_REVIEW_APLICADO` | No | Default: `APROBADO` |
| `HS_REVIEW_REVERTIDO` | No | Default: `PENDIENTE` |
| `HS_REVIEW_PENDIENTE` | No | Default: `PENDIENTE` |
| `HS_PERTENECE_SI` / `HS_PERTENECE_NO` | No | Default: `true` / `false` |
| `HS_MIN_CONFIDENCE_HIGH` | No | Default: `90` (umbral «seguro») |
| `HS_REVERT_CLEAR_GROUP_PROPS` | No | Default: limpiar group_key/hub al revertir |

Plantilla: `.env.example`

### `agrupacion.json` (reglas globales auto multi-TLD)

| Parámetro | Default | Significado |
|-----------|---------|-------------|
| `minSlugLength` | 4 | Mínimo caracteres del slug de marca. |
| `minDistinctTlds` | 2 | TLD distintos necesarios para activar unión. |
| `minCompaniesWithSlug` | 2 | Empresas mínimas con ese slug en el portal. |
| `preferCanonicalTld` | `com` | TLD preferido para clave canónica (`marca.com`). |
| `blockedSlugs` | lista larga | Palabras que nunca serán marca (group, mail, gmbh…). |

### `corporativos.json` (excepciones)

Estructura por familia:

- `id`: identificador (ej. `ravago`)
- `label`: descripción humana
- `canonicalKey`: group_key unificado
- `preferHubDomain`: dominio del hub
- `domains`: dominios adicionales que no comparten slug con la marca principal
- `brandSlugs`: slugs para matching flexible (opcional)
- `nameContains`: no usado globalmente de forma agresiva; reservado a familias

### `grupos_manuales.csv` (opcional)

```csv
company_id,grupo_id
49437319824,ravago
49529390441,ravago
```

- `company_id`: ID interno HubSpot de la empresa.
- `grupo_id`: clave de grupo o id de familia (`ravago` → resuelve a `ravago.com`).

Copiar desde `grupos_manuales.example.csv`.

---

## 10. Modos de ejecución y línea de comandos

Invocación base:

```
node src/index.js [modo] [filtros]
```

### Modos principales

| Modo | Parámetro | Descripción |
|------|-----------|-------------|
| Previsualizar | `--dry-run` | Solo CSV; **no modifica HubSpot**. |
| Aplicar | `--apply` | Escribe propiedades y crea asociaciones. |
| Revertir | `--revert --from <ruta.csv>` | Deshace según auditoría. |
| Ayuda | `--help` | Muestra ayuda en consola. |

### Filtros (modo prueba)

Todos activan «modo prueba» (sufijo `_prueba` en CSV si aplica):

| Filtro | Ejemplo | Efecto |
|--------|---------|--------|
| `--dominio` | `--dominio ravago` | Solo grupos cuyo `group_key` contiene el texto. |
| `--nombre` | `--nombre ravago` | Grupos con alguna empresa cuyo nombre, domain o email contiene el texto. |
| `--grupo` | `--grupo ravago` | Por `group_key`, `familyId` o grupo manual. |
| `--ids` | `--ids 123,456` | Grupos que incluyan esos `company_id` (incluye grupo completo). |
| `--max-grupos` | `--max-grupos 10` | Limita número de grupos procesados (tras otros filtros). |
| `--min-confidence` | `--min-confidence 90` | Excluye grupos con alguna empresa bajo el umbral. |

### Seguridad en apply masivo

- `--apply` **sin ningún filtro** está **bloqueado**.
- Para todo el portal: añadir `--confirm-full-run`.

### Revertir

```
node src/index.js --revert --from output/cambios_aplicados_prueba.csv
node src/index.js --revert --from output/cambios_aplicados.csv --run-id run_1780045017485
```

- Sin `--from`: intenta `output/cambios_aplicados_prueba.csv`.
- `--run-id`: solo filas de esa ejecución (CSV nuevos con columna `run_id`).

---

## 11. Scripts npm

| Script | Comando equivalente | Uso |
|--------|-------------------|-----|
| `npm run dry-run` | `--dry-run` | Informe completo sin filtros. |
| `npm run dry-run:seguro` | `--dry-run --min-confidence 90` | Informe solo alta confianza. |
| `npm run apply` | `--apply --confirm-full-run` | Volcado masivo (¡solo tras validar CSV!). |
| `npm run test:dry-run` | `--dry-run --dominio ravago` | Prueba dominio ravago. |
| `npm run ravago:dry-run` | `--dry-run --grupo ravago` | Prueba familia Ravago unificada. |
| `npm run test:apply` | `--apply --dominio ravago --max-grupos 5` | Aplica máx. 5 grupos filtrados. |
| `npm run revert:test` | `--revert --from output/cambios_aplicados_prueba.csv` | Revierte última prueba documentada. |

---

## 12. Archivos de salida (CSV)

Carpeta: `output/` (en `.gitignore`; no versionar datos ni tokens).

### Previsualización (`--dry-run`)

**`grupos_propuestos.csv`** o **`grupos_propuestos_prueba.csv`**

Columnas principales:

| Columna | Significado |
|---------|-------------|
| `group_key` | Clave de grupo asignada (ej. ravago.com) |
| `corporate_family` | id familia si aplica (ej. ravago) |
| `raw_domain` | Dominio original antes de unificar |
| `hub_id` | ID empresa principal del grupo |
| `company_id` | ID empresa |
| `company_name` | Nombre |
| `domain` | Dominio en HubSpot |
| `email_de_empresa` | Email corporativo |
| `key_source` | Regla que agrupó (domain, brand_multi_tld, corporate…) |
| `group_size` | Número de empresas en el grupo |
| `is_hub` | yes / no |
| `current_pertenece` | Valor actual de pertenece_a_grupo |

### Auditoría (`--apply`)

**`cambios_aplicados.csv`** / **`cambios_aplicados_prueba.csv`**

Incluye todo lo anterior más:

| Columna | Significado |
|---------|-------------|
| `run_id` | ID ejecución |
| `applied_at` | Fecha ISO |
| `association_from` / `association_to` | Par hub → miembro |
| `pertenece_antes` | Valor previo |
| `group_key_antes`, `hub_id_antes`, `review_status_antes` | Estado previo |
| `group_confidence` | Puntuación aplicada |
| `review_status_nuevo`, `pertenece_nuevo` | Valores nuevos |

**`asociaciones_prueba_run_<id>.csv`**

Solo pares de asociación creados (para revisión rápida).

### Reversión

**`revertido_cambios_aplicados_prueba_<timestamp>.csv`**

Copia del auditoría con `reverted_at` y `revert_action`.

---

## 13. Auditoría y reversión de cambios

### Por qué es crítico

Un apply masivo puede afectar decenas de miles de empresas. El CSV de auditoría es la **fuente de verdad** para deshacer.

### Qué hace --revert

1. Lee el CSV indicado.
2. Extrae pares únicos `association_from` → `association_to` (o `hub_id` + `company_id` si CSV antiguo).
3. **Archiva** asociaciones Grupo Empresa vía API labels/archive.
4. **Restaura** propiedades por empresa:
   - `pertenece` → valor anterior o No
   - `group_review_status` → PENDIENTE
   - Limpia group_key, hub, confidence si está configurado

### Limitaciones del revert

- Solo revierte lo **registrado en ese CSV** (misma ejecución).
- Cambios manuales posteriores en HubSpot no se detectan.
- CSV de ejecuciones antiguas sin `pertenece_antes` asume No si estaba vacío.
- Propiedades que no existan en HubSpot se omiten (configuración .env).

---

## 14. Variables de entorno (.env)

Ver sección 9. Reglas:

- Nunca commitear `.env` con token real.
- Rotar token si se expuso.
- Alinear `HS_PROP_*` con nombres **internos** exactos de HubSpot (Configuración → Propiedades).

---

## 15. Requisitos en HubSpot

### Private App

Permisos típicos (scopes):

- `crm.objects.companies.read`
- `crm.objects.companies.write`
- Permisos de asociaciones entre empresas (lectura y escritura)

### Objetos y asociaciones

- Objeto **Empresa** (Company).
- Asociación personalizada **Empresa ↔ Empresa** con etiqueta **Grupo Empresa** (`grupo_empresa`, typeId 1 en este portal).

### Propiedades custom a crear (si no existen)

| Etiqueta sugerida | Nombre interno | Tipo |
|------------------|----------------|------|
| Pertenece a grupo de empresas | `pertenece_a_grupo_de_empresas` | Radio: Sí (`true`) / No (`false`) |
| Group key | `group_key` | Texto |
| Group confidence | `group_confidence` | Número |
| Group review status | `group_review_status` | Select: PENDIENTE, APROBADO, RECHAZADO |
| Empresa principal del grupo | `grupo_empresa_principal_id` | Texto |
| ID ejecución script (opcional) | `grupo_script_run_id` | Texto |

---

## 16. Instalación

Requisitos: Node.js 18 o superior.

```bash
cd hubspot-grupos-empresas
npm install
copy .env.example .env
# Editar .env y pegar HUBSPOT_TOKEN
```

Comprobar:

```bash
node src/index.js --help
```

---

## 17. Guía de uso por fases

### Fase 0 — Preparación HubSpot

1. Crear/verificar Private App y token.
2. Crear asociación Grupo Empresa.
3. Crear propiedades custom y anotar nombres internos en `.env` si difieren.

### Fase 1 — Análisis sin impacto

```bash
npm run dry-run:seguro
```

Revisar `output/grupos_propuestos.csv`:

- Ordenar por `key_source`.
- Revisar muestras de `brand_multi_tld` (confianza media).
- Buscar falsos positivos (dominios raros, grupos enormes inesperados).

### Fase 2 — Prueba acotada

```bash
npm run ravago:dry-run
node src/index.js --apply --grupo ravago --max-grupos 1
```

Validar en HubSpot UI: asociaciones, pertenece=Sí, hub correcto (ravago.com).

### Fase 3 — Revertir prueba si hace falta

```bash
npm run revert:test
```

### Fase 4 — Volcado masivo (solo tras OK)

```bash
node src/index.js --dry-run --min-confidence 90
# Revisar CSV otra vez
node src/index.js --apply --confirm-full-run --min-confidence 90
```

Guardar `output/cambios_aplicados.csv` en lugar seguro antes de apply masivo.

### Fase 5 — Mantenimiento

- Añadir excepciones a `corporativos.json`.
- Añadir filas a `grupos_manuales.csv`.
- Ajustar `agrupacion.json` si hay demasiados falsos positivos multi-TLD.

---

## 18. Ejemplos reales (Ravago)

### Problema

Empresas con dominios `ravago.com`, `ravago.it`, `ravago.es`, `ravago.be`, `ravago.com.tr`, además de `resinex.com`, `cyjsa.com`, nombres dispares.

### Solución aplicada

| Dominio / caso | Mecanismo | group_key resultante |
|----------------|-----------|----------------------|
| ravago.it, ravago.es, ravago.be | Auto multi-TLD | ravago.com |
| ravago.com | Dominio / hub | ravago.com |
| resinex.com, cyjsa.com | corporativos.json | ravago.com |
| Empresa sin dominio pero nombre Ravago | Solo si no hay dominio útil + familia | ravago.com |

### Hub esperado

Empresa con dominio **ravago.com** (ej. NV RAVAGO COORDINATION CENTER), no la filial .it más antigua por fecha.

---

## 19. Niveles de confianza y estrategia de apply

| Estrategia | min-confidence | Incluye | Excluye |
|------------|----------------|---------|---------|
| Máxima seguridad | 90 | domain, root_domain, corporate, manual | email, brand_multi_tld |
| Equilibrada | 75 | + brand_multi_tld | solo email problemático aislado |
| Completa | sin filtro | todo lo agrupable | más riesgo |

Recomendación portal 79k: empezar **90**, subir cobertura solo tras revisar CSV.

---

## 20. Estructura del código fuente

```
src/
  index.js        Orquestación CLI, flujo dry-run/apply/revert
  hubspot.js      Cliente API: listar, batch update, asociaciones
  grouping.js     mapCompanies, buildGroups, pickHub, CSV manual
  corporate.js    corporativos.json, resolveGroupKey
  brand-key.js    Registro global multi-TLD, agrupacion.json
  domain.js       Normalización dominio, bloqueo genéricos
  filters.js      Filtros CLI y min-confidence
  audit.js        Filas auditoría, preparar revert
  revert.js       Ejecutar revert desde CSV
  config.js       Nombres propiedades, confianza, review status
  csv.js          Leer/escribir CSV
  stats.js        Estadísticas consola por key_source
  args.js         Parser argumentos línea de comandos
```

---

## 21. API de HubSpot utilizada

| Operación | Método y ruta |
|-----------|----------------|
| Listar empresas | GET `/crm/v3/objects/companies?limit=100&properties=...` |
| Actualizar empresas (lote) | POST `/crm/v3/objects/companies/batch/update` |
| Crear asociaciones | POST `/crm/v4/associations/companies/companies/batch/create` |
| Archivar asociaciones con etiqueta | POST `/crm/v4/associations/companies/companies/batch/labels/archive` |

Reintentos automáticos en HTTP 429 (rate limit) con backoff.

---

## 22. Limitaciones y riesgos

| Riesgo | Mitigación |
|--------|------------|
| Falsos positivos multi-TLD | min-confidence 90; revisar CSV; blockedSlugs |
| Emails @dominio genérico | Lista GENERIC_EMAIL_DOMAINS |
| Marcas distintas mismo slug corto | minSlugLength 4; blockedSlugs |
| Dominios hermanos no detectados | corporativos.json |
| Apply masivo irreversible sin CSV | Siempre dry-run antes; guardar auditoría |
| Propiedad inexistente en portal | Configurar .env; opcionales omitidas |
| Tiempo largo lectura 79k | Ejecutar en horario valle; usar filtros en pruebas |
| Token expuesto | Rotar Private App token |

---

## 23. Mantenimiento y ampliación

### Añadir nueva familia corporativa

Editar `corporativos.json`:

```json
{
  "id": "otra_familia",
  "canonicalKey": "matriz.com",
  "preferHubDomain": "matriz.com",
  "domains": ["filial.es", "marca-distinta.com"]
}
```

### Ajustar sensibilidad auto multi-TLD

Subir `minDistinctTlds` a 3 para ser más estricto.  
Ampliar `blockedSlugs` si aparecen marcas genéricas.

### Casos puntuales

`grupos_manuales.csv` con IDs de HubSpot (columna visible en URL o export).

---

## 24. Glosario

| Término | Definición |
|---------|------------|
| **group_key** | Identificador lógico del grupo; suele ser un dominio canónico. |
| **Hub** | Empresa principal; origen de asociaciones en modelo estrella. |
| **key_source** | Regla que asignó el group_key a esa empresa. |
| **Dry-run** | Simulación sin escritura en HubSpot. |
| **run_id** | Identificador único de una ejecución --apply. |
| **TLD** | Extensión de dominio (.com, .it, .es). |
| **Slug de marca** | Parte principal del dominio (ravago en ravago.it). |
| **canonicalKey** | group_key objetivo de una familia corporativa. |

---

## 25. Preguntas frecuentes

**¿Tengo que exportar las 79.000 empresas de HubSpot?**  
No. El script lee y escribe por API.

**¿El CSV que genera el script se importa en HubSpot?**  
No. Es solo informe y auditoría. La escritura es por API.

**¿Por qué no se agrupan dos empresas con el mismo nombre?**  
Por diseño: el nombre solo se usa en filtros de prueba o familias corporativas muy acotadas, no en todo el portal.

**¿Puedo deshacer solo Ravago?**  
Sí, si aplicaste con filtro y tienes `cambios_aplicados_prueba.csv`: `npm run revert:test`.

**¿Qué pasa si una propiedad no existe?**  
HubSpot devuelve error 400; hay que crear la propiedad o quitarla del .env (como `grupo_script_run_id`).

**¿Cuántas asociaciones crea un grupo de 10 empresas?**  
9 (modelo estrella: una por cada no-hub).

**¿Una empresa puede estar en varios grupos?**  
El script asigna una clave por ejecución; en HubSpot podrían existir otras asociaciones manuales previas no tocadas por el revert si no estaban en el CSV.

---

## Resumen en una frase

**Herramienta Node.js que analiza ~79.000 empresas en HubSpot, las agrupa por dominio y reglas configurables, crea asociaciones «Grupo Empresa» desde una empresa hub, marca «Pertenece a grupo = Sí», documenta cada cambio en CSV y permite revertir por ejecución.**

---

*Fin del documento. Versión alineada con el código en `hubspot-grupos-empresas` v1.0.*
