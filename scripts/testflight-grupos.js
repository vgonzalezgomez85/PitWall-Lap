#!/usr/bin/env node
// Reparte un build ya subido a TestFlight: espera a que App Store Connect lo
// procese, rellena el «Qué probar» con la entrada del CHANGELOG, lo asigna a
// los grupos de probadores y, si alguno es externo, lo manda a revisión beta.
//
// Usa la API de App Store Connect con una clave de equipo (rol Gestor de apps):
//   ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8
// ASC_KEY_ID y ASC_ISSUER_ID se pueden cambiar por entorno.
//
// Uso: node scripts/testflight-grupos.js <build> [--solo-internos]
//   <build>          número de build (CFBundleVersion), p. ej. 2610211046
//   --solo-internos  no lo da a los externos (Donantes): builds de prueba
//                    como los de la rama integracion_garage.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEY_ID = process.env.ASC_KEY_ID || 'NVR82983JB';
const ISSUER_ID = process.env.ASC_ISSUER_ID || '2387001d-c998-4ac9-aaf6-caee2cbf1d0a';
const BUNDLE_ID = require(path.join(ROOT, 'app.json')).expo.ios.bundleIdentifier;
const API = 'https://api.appstoreconnect.apple.com/v1';

const ESPERA_MS = 30_000;
const ESPERA_MAX_MS = 45 * 60_000;

function token() {
  const clave = fs.readFileSync(
    path.join(os.homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${KEY_ID}.p8`), 'utf8');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const datos = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({
    iss: ISSUER_ID, iat: ahora, exp: ahora + 15 * 60, aud: 'appstoreconnect-v1',
  })}`;
  const firma = crypto.sign('sha256', Buffer.from(datos), { key: clave, dsaEncoding: 'ieee-p1363' });
  return `${datos}.${firma.toString('base64url')}`;
}

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(ruta.startsWith('http') ? ruta : API + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${metodo} ${ruta} → ${res.status}: ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

/** Ítems de la entrada de la versión en CHANGELOG.md, sin markdown. */
function queProbar(version) {
  const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const bloque = md.split(/^## /m).find(b => b.startsWith(`[${version}]`));
  if (!bloque) return null;
  return bloque.split('\n')
    .filter(l => l.startsWith('- '))
    .map(l => l.replace(/\*\*|`/g, '').replace(/\s*\([^)]*\.(ts|tsx|js)[^)]*\)/g, ''))
    .join('\n')
    .slice(0, 4000);
}

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const numero = args.find(a => !a.startsWith('--'));
  const soloInternos = args.includes('--solo-internos');
  if (!numero) {
    console.error('uso: node scripts/testflight-grupos.js <build> [--solo-internos]');
    process.exit(1);
  }

  const app = (await api('GET', `/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) throw new Error(`no encuentro la app ${BUNDLE_ID}`);

  console.log(`==> Esperando a que se procese el build ${numero}`);
  const limite = Date.now() + ESPERA_MAX_MS;
  let build;
  for (;;) {
    const r = await api('GET',
      `/builds?filter[app]=${app.id}&filter[version]=${numero}&include=preReleaseVersion`);
    build = r.data[0];
    const estado = build?.attributes.processingState ?? 'SIN SUBIR AÚN';
    if (estado === 'VALID') {
      build.version = r.included?.find(i => i.type === 'preReleaseVersions')?.attributes.version;
      break;
    }
    if (estado === 'FAILED' || estado === 'INVALID') throw new Error(`build ${numero}: ${estado}`);
    if (Date.now() > limite) throw new Error(`build ${numero}: sigue en ${estado}`);
    console.log(`    ${estado}…`);
    await dormir(ESPERA_MS);
  }
  console.log(`    listo: ${build.version} (${numero})`);

  // Cumplimiento de exportación: app.json ya lo declara (sin cifrado propio),
  // pero si el build llega sin él no se puede repartir.
  if (build.attributes.usesNonExemptEncryption == null) {
    await api('PATCH', `/builds/${build.id}`, {
      data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } },
    });
  }

  const texto = build.version ? queProbar(build.version) : null;
  if (texto) {
    const locs = (await api('GET', `/builds/${build.id}/betaBuildLocalizations`)).data;
    const es = locs.find(l => l.attributes.locale.startsWith('es')) ?? locs[0];
    if (es) {
      await api('PATCH', `/betaBuildLocalizations/${es.id}`, {
        data: { type: 'betaBuildLocalizations', id: es.id, attributes: { whatsNew: texto } },
      });
    } else {
      await api('POST', '/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: 'es-ES', whatsNew: texto },
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
    }
    console.log('==> «Qué probar» rellenado desde el CHANGELOG');
  }

  const grupos = (await api('GET', `/apps/${app.id}/betaGroups?limit=50`)).data
    .filter(g => soloInternos ? g.attributes.isInternalGroup : true);
  for (const g of grupos) {
    const tipo = g.attributes.isInternalGroup ? 'interno' : 'externo';
    // Los internos con acceso a todos los builds ya lo reciben solos.
    if (g.attributes.isInternalGroup && g.attributes.hasAccessToAllBuilds) {
      console.log(`==> ${g.attributes.name} (${tipo}): ya recibe todos los builds`);
      continue;
    }
    await api('POST', `/betaGroups/${g.id}/relationships/builds`, {
      data: [{ type: 'builds', id: build.id }],
    });
    console.log(`==> ${g.attributes.name} (${tipo}): asignado`);
  }

  if (grupos.some(g => !g.attributes.isInternalGroup)) {
    try {
      await api('POST', '/betaAppReviewSubmissions', {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
      console.log('==> Enviado a revisión beta (los externos lo reciben al aprobarse)');
    } catch (e) {
      // Ya enviado, o Apple lo aprueba sin revisión: no es un fallo.
      console.log(`==> Revisión beta: ${e.message.split('\n')[0]}`);
    }
  }
}

main().catch(e => { console.error(`error: ${e.message}`); process.exit(1); });
