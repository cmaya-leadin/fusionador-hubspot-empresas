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
6. **Environment variables** (opcional pero recomendado en producción):

Despliega la sección **Environment variables** al crear el stack y añade:

```
SESSION_SECRET=genera-un-secreto-largo-aleatorio
ADMIN_PASSWORD=tu-password-seguro
```

Si no añades ninguna, el stack **igualmente despliega** con `admin` / `admin` y un secreto genérico — cámbialos en cuanto puedas.

| Variable | Descripción |
|----------|-------------|
| `SESSION_SECRET` | Secreto para sesiones y cifrado de tokens |
| `ADMIN_PASSWORD` | Contraseña del usuario `admin` (solo al crear la BD) |
| `SESSION_COOKIE_SECURE` | `true` solo con HTTPS delante del contenedor |
| `TRUST_PROXY` | `true` detrás de Nginx/Traefik (por defecto) |
| `PORT` | Puerto publicado en el **host** (por defecto `3080`; el contenedor sigue en 3000) |

Plantilla: `portainer.env.example`

> **Puerto en uso:** si ves `Bind for 0.0.0.0:3000 failed: port is already allocated`, define `PORT=3080` (u otro libre) en Environment variables y redeploy. La app quedará en `http://tu-vps:3080`.

### Opción B — Clonar en el VPS

```bash
git clone https://github.com/cmaya-leadin/fusionador-hubspot-empresas.git
cd fusionador-hubspot-empresas
cp .env.example .env
nano .env
docker compose up -d --build
```

### Reverse proxy y HTTPS

La app va **detrás de Nginx/Traefik/Caddy** con TLS. Guía completa: [`deploy/HTTPS.md`](deploy/HTTPS.md)

En Portainer:

```env
TRUST_PROXY=true
SESSION_COOKIE_SECURE=auto
```

Comprueba tras desplegar: `https://tu-dominio/api/health` → debe mostrar `"secure": true` y `"forwardedProto": "https"`.

Ejemplo Nginx: [`deploy/nginx-fusionador.conf.example`](deploy/nginx-fusionador.conf.example)

### Opción B — Clonar en el VPS

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
