// Parte Android del módulo BackgroundTts. En Android la locución va por
// react-native-tts (no hace falta sesión de audio especial), así que aquí solo
// vive lo que necesita Radio: por dónde sale el sonido.
//
//   • modoVoz(true): modo comunicación (MODE_IN_COMMUNICATION). Es el que
//     activa el cancelador de eco y la supresión de ruido del hardware, y por
//     defecto saca la voz por el auricular del móvil, no por el altavoz.
//   • altavoz(activo): forzar o quitar el altavoz (solo roles sin micro
//     abierto: el altavoz con el micro abierto es lo que provoca acoples).
//   • rutaSalida(): "cascos", "auricular" o "altavoz"; evento onRuta al
//     conectar o desconectar cascos.
//
// Las funciones de locución (speak, start…) no existen aquí: el wrapper JS
// solo las llama en iOS.

package expo.modules.backgroundtts

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundTtsModule : Module() {
  private var callback: AudioDeviceCallback? = null
  private var modoVoz = false
  private var altavoz = false

  private val audio: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("BackgroundTts")

    Events("onRuta")

    OnCreate {
      val am = audio ?: return@OnCreate
      val cb = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = avisarRuta()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) = avisarRuta()
      }
      am.registerAudioDeviceCallback(cb, Handler(Looper.getMainLooper()))
      callback = cb
    }

    OnDestroy {
      callback?.let { audio?.unregisterAudioDeviceCallback(it) }
      callback = null
    }

    Function("modoVoz") { activo: Boolean ->
      modoVoz = activo
      val am = audio ?: return@Function
      if (activo) {
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        aplicarAltavoz()
        servicio(true)
      } else {
        limpiarDispositivo(am)
        am.mode = AudioManager.MODE_NORMAL
        servicio(false)
      }
    }

    Function("altavoz") { activo: Boolean ->
      altavoz = activo
      if (modoVoz) aplicarAltavoz()
    }

    Function("rutaSalida") {
      rutaSalida()
    }

    // Radio: foto del audio para el diagnóstico en pantalla.
    Function("diagnosticoAudio") {
      val am = audio ?: return@Function "sin AudioManager"
      val disp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        am.communicationDevice?.type?.toString() ?: "-"
      } else "-"
      "modo=${am.mode} disp=$disp micMute=${am.isMicrophoneMute} cascos=${hayCascos(am)} " +
        "voz=$modoVoz alt=$altavoz ruta=${rutaSalida()}"
    }
  }

  /** Arranca (o actualiza) o para el servicio en primer plano de Radio. */
  private fun servicio(activo: Boolean) {
    val ctx = appContext.reactContext ?: return
    val intent = Intent(ctx, ServicioRadio::class.java)
    try {
      if (activo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
        else ctx.startService(intent)
      } else {
        ctx.stopService(intent)
      }
    } catch (e: Exception) {
      // Sin servicio la radio sigue funcionando con la pantalla encendida.
    }
  }

  private fun avisarRuta() {
    // Con cascos recién conectados, el altavoz forzado deja de tener sentido.
    if (modoVoz) aplicarAltavoz()
    // Solo llegan aquí altas y bajas de dispositivos (cascos).
    sendEvent("onRuta", mapOf("ruta" to rutaSalida(), "dispositivo" to true))
  }

  private fun hayCascos(am: AudioManager): Boolean {
    val tipos = mutableSetOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_USB_HEADSET,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) tipos.add(AudioDeviceInfo.TYPE_BLE_HEADSET)
    return am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in tipos }
  }

  private fun rutaSalida(): String {
    val am = audio ?: return ""
    if (hayCascos(am)) return "cascos"
    val enAltavoz = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      am.communicationDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
    } else {
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn
    }
    return if (enAltavoz || am.mode != AudioManager.MODE_IN_COMMUNICATION) "altavoz" else "auricular"
  }

  private fun aplicarAltavoz() {
    val am = audio ?: return
    // Con cascos manda el sistema (sale por ellos); solo se fuerza sin cascos.
    val usarAltavoz = altavoz && !hayCascos(am)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (usarAltavoz) {
        am.availableCommunicationDevices
          .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
          ?.let { am.setCommunicationDevice(it) }
      } else {
        am.clearCommunicationDevice()
      }
    } else {
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = usarAltavoz
    }
  }

  private fun limpiarDispositivo(am: AudioManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      am.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = false
    }
  }
}
