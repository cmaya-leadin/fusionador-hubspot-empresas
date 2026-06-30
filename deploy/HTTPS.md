# HTTPS con Plesk (proxy inverso)

La app escucha **HTTP** en el contenedor (puerto 3000, publicado en el host como `3080` por defecto). **Plesk** termina el TLS con Let's Encrypt y hace de proxy hacia el contenedor.

## 1. Contenedor en Portainer

Sigue usando `docker-compose.portainer.yml` (sin Traefik ni Certbot en Docker).

Variables recomendadas:

```
TRUST_PROXY=true
SESSION_COOKIE_SECURE=auto
PORT=3080
```

## 2. Certificado en Plesk

1. En Plesk: **Dominios** → tu dominio → **Certificados SSL/TLS**.
2. Instala **Let's Encrypt** (extensión gratuita de Plesk; Plesk renueva el certificado automáticamente).
3. Activa **Redirigir de HTTP a HTTPS** si lo deseas.

No hace falta ningún stack adicional en Docker para el certificado.

## 3. Proxy inverso en Plesk hacia el contenedor

1. **Dominios** → **Hosting y DNS** → el subdominio (ej. `fusionador.tudominio.com`).
2. **Proxy inverso** (o **Apache & nginx Settings** → modo proxy, según versión de Plesk).
3. URL de destino: `http://127.0.0.1:3080` (o la IP interna del host + puerto del stack).
4. Asegúrate de que Plesk/nginx reenvía las cabeceras:
   - `X-Forwarded-Proto`
   - `X-Forwarded-For`
   - `Host`

En la mayoría de instalaciones Plesk con proxy inverso oficial, esto ya viene configurado.

### Timeouts largos (simulación / fusión)

Las operaciones pueden durar muchos minutos. En **Configuración adicional de nginx** del dominio (si Plesk lo permite), o en Directivas adicionales:

```nginx
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
proxy_buffering off;
```

## 4. Comprobar

```
https://fusionador.tudominio.com/api/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "secure": true,
  "forwardedProto": "https",
  "trustProxy": true,
  "cookieSecure": "auto"
}
```

Si `forwardedProto` es `null`, el proxy de Plesk no está pasando `X-Forwarded-Proto`. Revisa la configuración del proxy inverso.

## Problemas frecuentes

| Síntoma | Solución |
|---------|----------|
| Login no persiste | `TRUST_PROXY=true`, `SESSION_COOKIE_SECURE=auto`, certificado SSL activo en Plesk |
| Simulación se corta | Aumentar `proxy_read_timeout` en nginx de Plesk |
| Funciona en `:3080` pero no en HTTPS | Revisar proxy inverso y `/api/health` |
| Error de certificado | Renovar Let's Encrypt desde Plesk → Certificados SSL/TLS |

## Seguridad

No expongas el puerto `3080` a Internet si solo accedes por Plesk. En el firewall, permite 80/443 a Plesk y deja `3080` solo en `127.0.0.1` (opcional: en el compose usa `127.0.0.1:3080:3000` en lugar de `3080:3000`).
