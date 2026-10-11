// Config plugin: quita la capacidad de notificaciones PUSH (`aps-environment`)
// de los entitlements de iOS.
//
// expo-notifications la añade sola al hacer prebuild, aunque no esté en
// `plugins` de app.json. La app solo usa notificaciones LOCALES (avisos del
// calendario), que no la necesitan; y con ella el build falla: una cuenta
// gratuita de Apple no admite Push, y con la de pago el identificador
// `es.pitwall.lap` no la lleva activada, así que el perfil de firma no la trae.

const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function withoutPush(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });
};
