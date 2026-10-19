# Relé de Radio por internet

Cloudflare Worker + un Durable Object por sala. Reenvía los mensajes de la
sala entre el móvil que la crea (anfitrión) y el resto (invitados), y da
credenciales TURN temporales para la voz. No entiende el protocolo: la lógica
de la sala sigue en la app. Ver la cabecera de `src/index.ts`.

## Desplegar (desde esta carpeta)

```bash
cd relay
npx wrangler login                 # una vez: abre el navegador
npx wrangler secret put TURN_TOKEN # pega el token de la clave TURN cuando lo pida
npx wrangler deploy                # publica en https://pitwall-radio-relay.<cuenta>.workers.dev
```

- `TURN_KEY_ID` (no secreto) está en `wrangler.toml`.
- El token TURN es secreto: solo con `wrangler secret put`, nunca en el repo.

## Probar

```bash
curl https://pitwall-radio-relay.<cuenta>.workers.dev/        # «PitWall Radio relay»
curl https://pitwall-radio-relay.<cuenta>.workers.dev/turn    # {"iceServers":[…]}
```
