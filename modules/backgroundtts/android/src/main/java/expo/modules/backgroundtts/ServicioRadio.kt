// Servicio en primer plano de Radio (Android). Sin él, con la pantalla
// apagada o la app en segundo plano, Android corta el acceso al micrófono
// (desde Android 11) y puede dormir la app: la voz dejaba de enviarse y
// recibirse en reposo. Muestra una notificación fija mientras se está en una
// sala; se arranca al entrar y se para al salir (BackgroundTtsModule.modoVoz).

package expo.modules.backgroundtts

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class ServicioRadio : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notificacion = crearNotificacion()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Tipo micrófono solo si ya hay permiso (Android 14 lo exige al arrancar;
      // tras conceder el micro se vuelve a llamar y se amplía el tipo).
      val conMicro = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
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
    return START_NOT_STICKY
  }

  private fun crearNotificacion(): Notification {
    val gestor = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      gestor.createNotificationChannel(
        NotificationChannel(CANAL, "Radio", NotificationManager.IMPORTANCE_LOW).apply {
          description = "PitWall Radio activa (voz con la pantalla apagada)"
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
    return builder
      .setContentTitle("PitWall Radio")
      .setContentText("Radio activa: voz y tiempos con la pantalla apagada")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .apply { if (abrir != null) setContentIntent(abrir) }
      .build()
  }

  companion object {
    private const val CANAL = "pitwall-radio"
    private const val ID_NOTIFICACION = 7080
  }
}
