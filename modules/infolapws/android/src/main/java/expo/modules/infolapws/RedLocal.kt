// Tráfico a la red local siempre por el WiFi, aunque el WiFi no tenga internet.
//
// En casi todas las pistas el WiFi del cronómetro NO tiene internet. Android,
// si hay datos móviles, puede tomar los datos como red principal, y entonces
// las conexiones sin red explícita salen por ellos: la IP del PC de la pista
// (192.168.x.x) deja de ser alcanzable. Pasa sobre todo al alejarse del WiFi
// y volver, cuando Android revalúa las redes y la reconexión falla en silencio.
//
// No basta con atar toda la app al WiFi (bindProcessToNetwork): Radio por
// internet funciona justo porque su tráfico sale por los datos móviles. Así
// que solo se ata al WiFi el socket que conecta a una IP privada; el resto
// sigue por donde decida Android.
//
// Cubre lo que va por OkHttp: el WebSocket de React Native (socket.io de
// PitWall Manager), su fetch (API REST) y el cliente WSS del TicTac nuevo.
// No cubre el UDP (TicTac antiguo, búsqueda automática).

package expo.modules.infolapws

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.facebook.react.modules.network.CustomClientBuilder
import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.websocket.WebSocketModule
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import javax.net.SocketFactory

object RedLocal {
  /** Red WiFi conectada ahora mismo (con o sin internet), o null. */
  @Volatile var redWifi: Network? = null
    private set

  private var instalado = false

  /** Instala el enrutado. Idempotente; llamar al arrancar la app. */
  fun instalar(ctx: Context) {
    synchronized(this) {
      if (instalado) return
      instalado = true
    }
    vigilarWifi(ctx)
    val ccb = CustomClientBuilder { builder -> builder.socketFactory(FabricaSocketsLan) }
    WebSocketModule.setCustomClientBuilder(ccb)
    NetworkingModule.setCustomClientBuilder(ccb)
  }

  private fun vigilarWifi(ctx: Context) {
    val cm = ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      ?: return
    // Sin exigir internet: el WiFi de la pista no lo tiene. requestNetwork (y
    // no solo escuchar) pide además a Android que no suelte esa red aunque no
    // sea la principal.
    val peticion = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .build()
    try {
      cm.requestNetwork(peticion, object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { redWifi = network }
        override fun onLost(network: Network) { if (redWifi == network) redWifi = null }
      })
    } catch (e: Exception) {
      // Sin permiso o sin servicio: todo sigue como antes (red por defecto).
    }
  }

  /** IP de red local: 10/8, 172.16/12, 192.168/16, 169.254/16 o IPv6 local. */
  fun esLocal(dir: InetAddress): Boolean {
    if (dir.isSiteLocalAddress || dir.isLinkLocalAddress) return true
    if (dir is Inet6Address) {
      val primero = dir.address[0].toInt() and 0xfe
      return primero == 0xfc   // fc00::/7 (ULA)
    }
    return false
  }
}

/** Socket que, si el destino es una IP local, se ata al WiFi antes de conectar. */
private class SocketLan : Socket() {
  override fun connect(endpoint: SocketAddress?, timeout: Int) {
    val dir = (endpoint as? InetSocketAddress)?.address
    val wifi = RedLocal.redWifi
    if (dir != null && wifi != null && RedLocal.esLocal(dir)) {
      try { wifi.bindSocket(this) } catch (e: Exception) { /* sigue por la red por defecto */ }
    }
    super.connect(endpoint, timeout)
  }
}

/** Fábrica de sockets para OkHttp (crea el socket sin conectar y luego llama a connect). */
object FabricaSocketsLan : SocketFactory() {
  override fun createSocket(): Socket = SocketLan()

  override fun createSocket(host: String, port: Int): Socket =
    SocketLan().apply { connect(InetSocketAddress(host, port)) }

  override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
    SocketLan().apply {
      bind(InetSocketAddress(localHost, localPort))
      connect(InetSocketAddress(host, port))
    }

  override fun createSocket(host: InetAddress, port: Int): Socket =
    SocketLan().apply { connect(InetSocketAddress(host, port)) }

  override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
    SocketLan().apply {
      bind(InetSocketAddress(localAddress, localPort))
      connect(InetSocketAddress(address, port))
    }
}
