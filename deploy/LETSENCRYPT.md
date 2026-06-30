# Let's Encrypt con renovación automática (Traefik)

Traefik obtiene y **renueva solo** los certificados Let's Encrypt. No hace falta Certbot ni cron.

## Requisitos previos

1. Dominio propio (ej. `fusionador.tudominio.com`).
2. Registro **DNS tipo A** apuntando a la IP pública del VPS.
3. Puertos **80** y **443** abiertos (firewall + proveedor cloud).
4. Si ya tienes otro stack usando el 80/443 (Nginx, otro Traefik), deténlo o usa un único proxy.

## Despliegue en Portainer

1. Elimina o detén el stack antiguo que publicaba el puerto `3080` (evita duplicados).
2. **Stacks** → **Add stack** (o edita el existente).
3. **Repository**:
   - URL: `https://github.com/cmaya-leadin/fusionador-hubspot-empresas`
   - Compose path: **`docker-compose.letsencrypt.yml`**
4. **Environment variables** (plantilla: `portainer.letsencrypt.env.example`):

```
FUSIONADOR_DOMAIN=fusionador.tudominio.com
LETSENCRYPT_EMAIL=tu@email.com
SESSION_SECRET=secreto-largo-aleatorio
ADMIN_PASSWORD=password-seguro
```

5. **Deploy the stack**.

La primera vez Traefik puede tardar 1–2 minutos en emitir el certificado.

## Comprobar

```bash
curl -I https://fusionador.tudominio.com
```

Debe responder `200` o `302` con certificado válido.

```bash
curl https://fusionador.tudominio.com/api/health
```

```json
{
  "status": "ok",
  "secure": true,
  "forwardedProto": "https",
  "trustProxy": true,
  "cookieSecure": "auto"
}
```

## Renovación

- Los certificados se guardan en el volumen Docker `traefik_letsencrypt` (`acme.json`).
- Traefik renueva automáticamente antes de caducar (~30 días antes).
- **No borres** el volumen `traefik_letsencrypt` o tendrás que volver a emitir (límites de rate de Let's Encrypt).

## Logs si falla el certificado

Portainer → **Containers** → `traefik` → **Logs**

Errores habituales:

| Error | Causa |
|-------|--------|
| `Unable to obtain ACME certificate` | DNS no apunta al VPS o puerto 80 cerrado |
| `rate limit` | Demasiados intentos; espera 1 h o usa staging |
| `port 80 already in use` | Otro servicio ocupa el 80 |

### Prueba con staging (opcional)

Solo si falla repetidamente en producción, en el compose de Traefik añade temporalmente:

```yaml
- --certificatesresolvers.letsencrypt.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory
```

Luego quítalo para el certificado real.

## Sin Traefik (ya tienes Nginx)

Usa Certbot en el host:

```bash
sudo certbot --nginx -d fusionador.tudominio.com
```

Certbot instala un timer systemd para renovar. Ver `nginx-fusionador.conf.example`.
