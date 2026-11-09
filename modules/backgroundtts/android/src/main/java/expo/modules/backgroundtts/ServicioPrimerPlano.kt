// Servicio en primer plano (Android): mantiene viva la app con la pantalla
// apagada, como hace Spotify con la música. Es el equivalente al keep-alive de
// audio de iOS. Tiene dos motivos, y sigue activo mientras quede alguno:
//
//   • Pista: conectado a PitWall Manager o TicTac. Sin el servicio, al apagar
//     la pantalla Android dormía la app y el WiFi, el socket dejaba de recibir
//     vueltas (el entreno grabado se quedaba en 4 de 20) y no se locutaba nada.
//   • Radio: dentro de una sala. Desde Android 11 el micro en segundo plano
//     solo se puede usar desde un servicio en primer plano.
//
// Mientras corre retiene un WakeLock parcial (procesador despierto) y un
// WifiLock (el WiFi no se duerme con la pantalla apagada). La notificación
// fija es obligatoria. Lo arranca y para BackgroundTtsModule.

package expo.modules.backgroundtts

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

class ServicioPrimerPlano : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val pista = intent?.getBooleanExtra(EXTRA_PISTA, false) ?: false
    val radio = intent?.getBooleanExtra(EXTRA_RADIO, false) ?: false
    val notificacion = crearNotificacion(pista, radio)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Tipo micrófono solo en Radio y con permiso (Android 14 lo exige al
      // arrancar; tras conceder el micro se vuelve a llamar y se amplía el tipo).
      val conMicro = radio &&
        checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
      var tipos = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      if (conMicro) tipos = tipos or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      try {
        startForeground(ID_NOTIFICACION, notificacion, tipos)
      } catch (e: Exception) {
        startForeground(ID_NOTIFICACION, notificacion, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      }
    } else {
      startForeground(ID_NOTIFICACION, notificacion)
    }
    retenerBloqueos()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    liberarBloqueos()
    super.onDestroy()
  }

  private fun retenerBloqueos() {
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PitWallLap:conexion").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
    if (wifiLock == null) {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      // HIGH_PERF está obsoleto en Android 14, pero sigue siendo el único modo
      // que mantiene el WiFi activo con la pantalla apagada (LOW_LATENCY solo
      // vale con la app en primer plano y la pantalla encendida).
      @Suppress("DEPRECATION")
      wifiLock = wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "PitWallLap:conexion")?.apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun liberarBloqueos() {
    try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    try { wifiLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    wakeLock = null
    wifiLock = null
  }

  private fun crearNotificacion(pista: Boolean, radio: Boolean): Notification {
    val gestor = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      gestor.createNotificationChannel(
        NotificationChannel(CANAL, "Conexión en segundo plano", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Tiempos, voz y Radio con la pantalla apagada"
          setShowBadge(false)
        },
      )
    }
    val abrir = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CANAL)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val (titulo, texto) = when {
      pista && radio -> "PitWall Lap" to "Conectado a la pista y Radio activa"
      radio -> "PitWall Radio" to "Radio activa: voz y tiempos con la pantalla apagada"
      else -> "PitWall Lap" to "Conectado a la pista: tiempos y voz con la pantalla apagada"
    }
    return builder
      .setContentTitle(titulo)
      .setContentText(texto)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .apply { if (abrir != null) setContentIntent(abrir) }
      .build()
  }

  companion object {
    // Se mantiene el id del canal de Radio para no dejar un canal huérfano en
    // los móviles que ya lo tenían creado.
    private const val CANAL = "pitwall-radio"
    private const val ID_NOTIFICACION = 7080
    const val EXTRA_PISTA = "pista"
    const val EXTRA_RADIO = "radio"
  }
}
