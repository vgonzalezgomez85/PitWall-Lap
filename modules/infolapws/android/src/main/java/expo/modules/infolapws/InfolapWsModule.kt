// Cliente WebSocket TLS para el servidor InfoLap del TicTac nuevo.
//
// El TicTac abre `wss://<pc>:12543/` con un certificado autofirmado
// (CN=InfoLapServer) que genera en cada instalación, así que no se puede
// fijar de antemano. El WebSocket de React Native lo rechaza; este módulo
// usa su propio OkHttpClient que acepta ese certificado. El TrustManager
// permisivo vive SOLO en este cliente: el resto de la app no se ve afectado.

package expo.modules.infolapws

import android.annotation.SuppressLint
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class InfolapWsModule : Module() {
  private val sockets = ConcurrentHashMap<Int, WebSocket>()

  private val client: OkHttpClient by lazy { buildClient() }

  override fun definition() = ModuleDefinition {
    Name("InfolapWs")

    Events("onOpen", "onMessage", "onClose", "onError")

    // Abre la conexión `id`. Los eventos llevan ese id para que la capa JS
    // descarte los de conexiones anteriores.
    Function("connect") { id: Int, url: String ->
      sockets.remove(id)?.cancel()
      val request = Request.Builder().url(url).build()
      val ws = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          sendEvent("onOpen", mapOf("id" to id))
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          sendEvent("onMessage", mapOf("id" to id, "data" to text))
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          sendEvent("onMessage", mapOf("id" to id, "data" to bytes.utf8()))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          sockets.remove(id, webSocket)
          sendEvent("onClose", mapOf("id" to id, "code" to code, "reason" to reason))
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          sockets.remove(id, webSocket)
          sendEvent("onError", mapOf("id" to id, "message" to (t.message ?: t.javaClass.simpleName)))
        }
      })
      sockets[id] = ws
    }

    Function("close") { id: Int ->
      val ws = sockets.remove(id)
      ws?.close(1000, null)
      Unit
    }

    OnDestroy {
      for (ws in sockets.values) ws.cancel()
      sockets.clear()
    }
  }

  @SuppressLint("CustomX509TrustManager", "TrustAllX509TrustManager")
  private fun buildClient(): OkHttpClient {
    val trustAll = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    val ssl = SSLContext.getInstance("TLS")
    ssl.init(null, arrayOf<TrustManager>(trustAll), SecureRandom())
    return OkHttpClient.Builder()
      .sslSocketFactory(ssl.socketFactory, trustAll)
      // El certificado va a nombre de "InfoLapServer", no de la IP del PC.
      .hostnameVerifier { _, _ -> true }
      .connectTimeout(3, TimeUnit.SECONDS)
      // Sin timeout de lectura: entre vueltas puede no llegar nada un rato.
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .pingInterval(15, TimeUnit.SECONDS)
      .build()
  }
}
