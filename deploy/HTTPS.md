# HTTPS detrás de reverse proxy

La app escucha **HTTP** dentro del contenedor (puerto 3000). El TLS lo termina Nginx, Traefik o Caddy en el VPS.

## Variables en Portainer

```
TRUST_PROXY=true
SESSION_COOKIE_SECURE=auto
```

| Valor | Comportamiento |
|-------|----------------|
| `SESSION_COOKIE_SECURE=auto` | Cookie `Secure` solo si el proxy envía `X-Forwarded-Proto: https` (recomendado) |
| `SESSION_COOKIE_SECURE=true` | Siempre cookie Secure (requiere `TRUST_PROXY=true`) |
| `SESSION_COOKIE_SECURE=false` | Solo para pruebas en HTTP directo (`http://IP:3080`) |

Tras cambiar variables: **Update the stack** y reconstruye si actualizaste el código.

## Comprobar que el proxy envía cabeceras

Abre (o haz curl a):

```
https://fusionador.tudominio.com/api/health
```

Respuesta esperada con HTTPS correcto:

```json
{
  "status": "ok",
  "secure": true,
  "forwardedProto": "https",
  "trustProxy": true,
  "cookieSecure": "auto"
}
```

Si `forwardedProto` es `null` o `secure` es `false`, el proxy **no** está pasando `X-Forwarded-Proto`. Revisa la config de Nginx/Traefik.

## Let's Encrypt (renovación automática)

Guía completa: [`deploy/LETSENCRYPT.md`](deploy/LETSENCRYPT.md) — stack `docker-compose.letsencrypt.yml` con Traefik.

## Nginx manual

Ver `deploy/nginx-fusionador.conf.example`. Puntos críticos:

- `proxy_set_header X-Forwarded-Proto $scheme;`
- `proxy_buffering off;` y timeouts largos para simulación/fusión

## Traefik (labels en el servicio)

Si usas Traefik en la misma red Docker, puedes quitar `ports:` del compose y añadir:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.fusionador.rule=Host(`fusionador.tudominio.com`)
  - traefik.http.routers.fusionador.entrypoints=websecure
  - traefik.http.routers.fusionador.tls.certresolver=letsencrypt
  - traefik.http.services.fusionador.loadbalancer.server.port=3000
```

Traefik envía `X-Forwarded-Proto` automáticamente.

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---------|-------|----------|
| Login no mantiene sesión | Cookie Secure / proxy | `TRUST_PROXY=true`, `SESSION_COOKIE_SECURE=auto`, cabecera `X-Forwarded-Proto` |
| Simulación se corta a mitad | Timeout del proxy | `proxy_read_timeout 3600s`, `proxy_buffering off` |
| Funciona en `:3080` pero no en HTTPS | Proxy mal configurado | Revisar `/api/health` |
| Bucle de redirección | HTTP y HTTPS mal enlazados | Un solo `server` 443 o redirect 80→443 |

## No expongas el puerto 3080 a Internet

En producción, deja el contenedor solo en red interna o `127.0.0.1:3080` y accede únicamente por el dominio HTTPS.
