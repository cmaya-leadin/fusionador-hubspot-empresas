# HubSpot — Grupos de empresas

Script para ~79.000 empresas con **estrategia en capas** (de más fiable a más arriesgada).

## Estrategia para todo el portal (minimizar errores)

| Nivel | Mecanismo | Confianza | Qué hace |
|-------|-----------|-----------|----------|
| 1 | **Dominio exacto** | 100 | `acme.es` + `acme.es` → mismo grupo |
| 2 | **Dominio raíz** (HubSpot) | 100 | Usa campo `dominio_raiz` si está relleno |
| 3 | **Auto multi-TLD** (`agrupacion.json`) | 75 | `acme.it` + `acme.de` + `acme.com` → `acme.com` **solo si** hay ≥2 TLD distintos y ≥2 empresas |
| 4 | **corporativos.json** | 95 | Excepciones: dominios distintos que son la misma familia (Resinex → Ravago) |
| 5 | **grupos_manuales.csv** | 90 | Casos puntuales por `company_id` |
| — | **Bloqueados** | — | `gmail.com`, `live.com`, etc. **nunca** agrupan |

### Por qué no hace falta 79.000 entradas en JSON

- **Ravago.it / .es / .be** se unen solas si existen varias TLD en el portal (regla auto).
- **corporativos.json** solo lista **excepciones** (marcas distintas del mismo grupo: `resinex.com` → `ravago.com`).
- Slugs cortos o genéricos (`group`, `mail`) están en **lista de bloqueo**.

### Ejecución recomendada

```bash
# 1) Informe global + solo grupos de alta confianza (dominio exacto + corporativo)
npm run dry-run:seguro

# 2) Revisar CSV: grupos_propuestos.csv (columna key_source)

# 3) Prueba acotada
npm run ravago:dry-run

# 4) Aplicar prueba
npm run test:apply

# 5) Masivo solo tras validar
node src/index.js --apply --confirm-full-run --min-confidence 90
```

`--min-confidence 90` **excluye** grupos que dependen solo de auto multi-TLD (75) o email (80).

Para incluir también multi-TLD automático:

```bash
node src/index.js --dry-run --min-confidence 75
```

## Archivos de configuración

| Archivo | Uso |
|---------|-----|
| `agrupacion.json` | Umbrales globales: longitud mínima slug, TLDs mínimos, slugs bloqueados |
| `corporativos.json` | **Solo excepciones** corporativas (no una entrada por empresa) |
| `grupos_manuales.csv` | Overrides por ID |

## Instalación y uso

Ver secciones anteriores del README: `.env`, `--revert`, propiedades HubSpot, etc.

```bash
npm install
npm run dry-run:seguro
npm run revert:test
```

## Revertir

```bash
node src/index.js --revert --from output/cambios_aplicados_prueba.csv
```

## Fusión de empresas duplicadas

Fusiona empresas con **nombre o dominio coincidente** (omite `inactive` y solo `proveedor`).

Reglas corregidas:
- Agrupación **directa** (sin union-find transitivo)
- Empresas **sin nombre** no se agrupan por nombre
- Fusión **en cadena** con reintento por ID canónico de HubSpot
- CSV de resultados con errores en `output/fusiones_resultados_*.csv`

### Ejecución recomendada

```bash
# 1) Informe global (no modifica HubSpot, ~4 min)
npm run merge:dry-run

# 2) Revisar CSV en output/fusiones_propuestas_*.csv

# 3) Prueba acotada (5 grupos)
npm run merge:test

# 4) Prueba con filtro
npm run merge:dry-run -- --dominio acme --max-grupos 10

# 5) Aplicar prueba acotada
npm run merge:apply:test -- --dominio acme

# 6) Masivo solo tras validar
npm run merge:apply
```

| Script npm | Qué hace |
|------------|----------|
| `merge:dry-run` | Previsualiza todas las fusiones posibles |
| `merge:test` | Dry-run limitado a 5 grupos |
| `merge:apply:test` | Aplica fusiones (máx. 5 grupos) |
| `merge:apply` | Fusión masiva (`--confirm-full-run`) |
| `merge:server` | Servidor HTTP en `:3000` (opcional) |

Opciones extra tras `--`: `--dominio`, `--nombre`, `--ids`, `--max-grupos`.
