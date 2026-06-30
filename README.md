# HubSpot Fusionador de Entidades

Herramienta web para detectar y fusionar entidades duplicadas en HubSpot (empresas y contactos) con criterios personalizables, simulación previa y panel de administración.

## Características

- **Autenticación** con usuario y contraseña
- **Proyectos** por usuario con token HubSpot propio
- **Criterios de fusión** configurables desde el dashboard
- **Simulación** con vista previa del objeto fusionado (sin modificar HubSpot)
- **Fusión real** con progreso en tiempo real y **reintento de fallos**
- **Roles**: admin (ve todos los proyectos) y usuario (solo los suyos)
- **Sistema de logs** en tiempo real
- **Guía de uso** integrada

## Requisitos

- Node.js ≥ 18 (o Docker)
- Private App de HubSpot con scopes:
  - `crm.objects.companies.read` / `write`
  - `crm.objects.contacts.read` / `write`

## Instalación local

```bash
npm install
cp .env.example .env
# Edita .env: SESSION_SECRET y ADMIN_PASSWORD
npm start
```

Abre http://localhost:3000

**Usuario por defecto:** `admin` / contraseña definida en `ADMIN_PASSWORD`.

## Docker (local)

```bash
cp .env.example .env
# Edita .env con secretos fuertes
docker compose up -d --build
```

La app queda en http://localhost:3000

Datos persistentes en volúmenes Docker:
- `fusionador_data` — base SQLite
- `fusionador_output` — CSV de fusiones

## Despliegue en VPS con Portainer

### Opción A — Stack desde repositorio Git (Portainer)

1. En Portainer: **Stacks** → **Add stack** (o edita el stack fallido y **Pull and redeploy**)
2. Nombre: `hubspot-fusionador`
3. **Build method**: Repository
4. Repository URL: `https://github.com/cmaya-leadin/fusionador-hubspot-empresas`
5. Compose path: `docker-compose.portainer.yml`
6. **Environment variables** — añade al menos estas dos (no necesitas archivo `.env` en el VPS):

| Variable | Descripción |
|----------|-------------|
| `SESSION_SECRET` | Secreto largo y aleatorio (**obligatorio**) |
| `ADMIN_PASSWORD` | Contraseña inicial del admin (**obligatorio**) |
| `SESSION_COOKIE_SECURE` | `true` solo con HTTPS delante del contenedor |
| `TRUST_PROXY` | `true` detrás de Nginx/Traefik (por defecto) |
| `PORT` | Puerto publicado en el host (por defecto `3000`) |

Puedes copiar la plantilla desde `portainer.env.example`.

7. **Deploy the stack**

> Si ves `env file .env not found`, actualiza el stack desde el repo (se eliminó la dependencia de `.env` en `docker-compose.portainer.yml`).

### Opción B — Clonar en el VPS

```bash
git clone https://github.com/cmaya-leadin/fusionador-hubspot-empresas.git
cd fusionador-hubspot-empresas
cp .env.example .env
nano .env
docker compose up -d --build
```

### Reverse proxy (recomendado)

Expón el puerto 3000 solo internamente y pon Nginx/Traefik con HTTPS delante. Con TLS activo:

```env
SESSION_COOKIE_SECURE=true
TRUST_PROXY=true
```

## Uso

1. Inicia sesión y crea un proyecto.
2. Configura el token PAT de HubSpot y el tipo de entidad.
3. Ajusta los **Criterios de fusión**.
4. Ejecuta **Simular Fusión** para ver grupos y vista previa.
5. Si todo es correcto, **Aplicar Fusión**.
6. Si hay errores, usa **Reintentar fallos**.

## Estructura

```
src/
  server.js          # Servidor Express
  db.js              # SQLite (usuarios, proyectos, logs)
  merge.js           # Motor de fusión
  merge-retry.js     # Reintento de fusiones fallidas
  hubspot.js         # Cliente API HubSpot
public/              # Frontend (HTML/CSS/JS)
data/                # Base de datos SQLite (volumen Docker)
output/              # CSV exportados (volumen Docker)
```

## Seguridad

- Los tokens HubSpot se almacenan cifrados (AES-256-GCM).
- La fusión masiva sin filtros está bloqueada por defecto.
- Cambia `SESSION_SECRET` y `ADMIN_PASSWORD` en producción.
- No subas `.env` al repositorio.

## Licencia

Uso interno — Leadin
