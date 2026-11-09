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

## La app y el relé

La dirección del relé no va en el código de la app. Solo los builds que se
compilan con ella traen el modo por internet:

```
EXPO_PUBLIC_RADIO_RELAY_URL=wss://pitwall-radio-relay.<cuenta>.workers.dev \
  APPLE_TEAM_ID=… npm run ios:testflight     # sube solo a internos
EXPO_PUBLIC_RADIO_RELAY_URL=wss://… npm run apk   # no se copia a la web
```

Sin la variable (builds públicos de TestFlight y APK de la web), Radio solo
funciona por WiFi local.
