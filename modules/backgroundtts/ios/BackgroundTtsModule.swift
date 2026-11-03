// REQUISITO CRÍTICO PARA QUE LA VOZ SUENE EN BACKGROUND:
//   En `ios/SlotTimerPro/Info.plist` debe estar:
//
//     <key>UIBackgroundModes</key>
//     <array>
//       <string>audio</string>
//     </array>
//
// Sin esa clave, iOS suspende la app aunque el código nativo configure
// AVAudioSession correctamente. Está declarada en `app.json` pero el
// prebuild de Expo a veces no la propaga al Info.plist, así que conviene
// verificarla después de cada `npx expo prebuild --clean`.

import ExpoModulesCore
import AVFoundation

/// Delegado del sintetizador: avisa a JS de cuándo empieza y acaba de hablar
/// (Radio silencia el micro abierto mientras suena la locución).
///
/// Se cuentan las frases empezadas y terminadas: antes el fin se avisaba solo
/// si `isSpeaking` ya era false dentro de `didFinish`, y iOS a veces aún dice
/// true en ese instante. El aviso de fin no llegaba nunca y Radio dejaba el
/// micro silenciado para siempre tras la primera locución.
private final class DelegadoLocucion: NSObject, AVSpeechSynthesizerDelegate {
  var alCambiar: ((Bool) -> Void)?
  private var enCurso = 0
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didStart u: AVSpeechUtterance) {
    enCurso += 1
    if enCurso == 1 { alCambiar?(true) }
  }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { terminada() }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { terminada() }
  /// También los usa la locución amplificada de Radio, que no pasa por el
  /// sintetizador que tiene este delegado. Siempre desde el hilo principal.
  func empezada() {
    enCurso += 1
    if enCurso == 1 { alCambiar?(true) }
  }
  func terminada() {
    enCurso = max(0, enCurso - 1)
    if enCurso == 0 { alCambiar?(false) }
  }
}

/// Locución de Radio amplificada. Con la voz activa, el procesado de voz de
/// WebRTC (modo voiceChat) atenúa todo el audio que no pasa por él, también la
/// locución de la app, y los avisos de equipo (Box, Push…) se oían muy flojos.
/// El WebRTC que usamos no deja quitar esa atenuación, así que se compensa
/// subiendo la señal: la frase se sintetiza a memoria, se normaliza y se
/// comprime (más volumen percibido sin recortar) y suena por un AVAudioEngine.
private enum Amplificador {
  /// Ganancia máxima al normalizar (×8 ≈ +18 dB): que una frase casi muda no
  /// convierta el ruido de fondo en estruendo.
  static let gananciaMaxima: Float = 8
  /// Compresión suave (tanh): las partes flojas suben ≈ k/tanh(k) (×2,6 ≈
  /// +8 dB) y los picos se quedan en su sitio.
  static let compresion: Float = 2.5
  /// Pico final, con un poco de margen para no saturar.
  static let pico: Float = 0.97

  /// Une los trozos que entrega el sintetizador en un único buffer mono
  /// Float32 y lo amplifica. `nil` si no hay audio o el formato no se conoce.
  static func procesar(_ trozos: [AVAudioPCMBuffer]) -> AVAudioPCMBuffer? {
    guard let primero = trozos.first else { return nil }
    let total = trozos.reduce(0) { $0 + Int($1.frameLength) }
    guard total > 0,
          let formato = AVAudioFormat(standardFormatWithSampleRate: primero.format.sampleRate, channels: 1),
          let salida = AVAudioPCMBuffer(pcmFormat: formato, frameCapacity: AVAudioFrameCount(total)),
          let destino = salida.floatChannelData?[0] else { return nil }
    var n = 0
    for trozo in trozos {
      let frames = Int(trozo.frameLength)
      if let f = trozo.floatChannelData?[0] {
        for i in 0..<frames { destino[n + i] = f[i] }
      } else if let e = trozo.int16ChannelData?[0] {
        for i in 0..<frames { destino[n + i] = Float(e[i]) / 32768 }
      } else if let e = trozo.int32ChannelData?[0] {
        for i in 0..<frames { destino[n + i] = Float(e[i]) / 2147483648 }
      } else {
        return nil
      }
      n += frames
    }
    salida.frameLength = AVAudioFrameCount(n)
    var maximo: Float = 0
    for i in 0..<n { maximo = max(maximo, abs(destino[i])) }
    guard maximo > 0 else { return salida }
    let normal = min(gananciaMaxima, 1 / maximo)
    let escala = pico / tanh(compresion)
    for i in 0..<n { destino[i] = tanh(compresion * destino[i] * normal) * escala }
    return salida
  }
}

public class BackgroundTtsModule: Module {
  private let synth = AVSpeechSynthesizer()
  private let delegado = DelegadoLocucion()
  private var keepAlivePlayer: AVAudioPlayer?
  private var started = false
  /// Radio con voz activa: la sesión debe permitir el micro (playAndRecord +
  /// voiceChat). Antes cada locución la devolvía a `.playback` y cortaba la
  /// captura del micro de WebRTC en el iPhone.
  private var modoVoz = false
  /// Radio: sacar el sonido por el altavoz (solo roles sin micro abierto). Va
  /// como opción de categoría (`.defaultToSpeaker`) y no como override, porque
  /// cada `setCategory` borra el override. Con cascos, iOS los prefiere igual.
  private var altavoz = false
  private var observadorRuta: NSObjectProtocol?
  /// Locución amplificada de Radio (ver `Amplificador`). Sintetizador aparte,
  /// sin delegado: el inicio y el fin los marca la reproducción.
  private let synthRadio = AVSpeechSynthesizer()
  private let motor = AVAudioEngine()
  private let reproductor = AVAudioPlayerNode()
  private var formatoMotor: AVAudioFormat?
  /// Frases amplificadas que están sonando (o en cola). Hilo principal.
  private var amplificadasSonando = 0
  /// Sube al callar: las frases de antes que aún se estén sintetizando o
  /// acaben de sonar ya no cuentan.
  private var generacion = 0

  public func definition() -> ModuleDefinition {
    Name("BackgroundTts")

    Events("onLocucion", "onRuta")

    OnCreate {
      self.delegado.alCambiar = { [weak self] hablando in
        self?.sendEvent("onLocucion", ["hablando": hablando])
      }
      self.synth.delegate = self.delegado
      // Cascos que se conectan o desconectan: se avisa a JS para recalcular
      // la salida (y el aviso de «ponte cascos»).
      self.observadorRuta = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
      ) { [weak self] nota in
        guard let self = self else { return }
        // `dispositivo`: se conectó o desconectó algo (cascos). Los cambios por
        // reconfigurar la categoría (cada locución) no cuentan: JS reinicia la
        // voz solo con los de dispositivo.
        let motivo = (nota.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
          .flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
        let dispositivo = motivo == .newDeviceAvailable || motivo == .oldDeviceUnavailable
        self.sendEvent("onRuta", ["ruta": self.rutaSalida(), "dispositivo": dispositivo])
      }
    }

    OnDestroy {
      if let o = self.observadorRuta { NotificationCenter.default.removeObserver(o) }
    }

    // Radio: altavoz sí/no. Solo tiene efecto con la voz activa (modoVoz).
    Function("altavoz") { (activo: Bool) -> Void in
      self.altavoz = activo
      if self.modoVoz { _ = self.configureAudioSession() }
    }

    // Radio: foto de la sesión de audio para el diagnóstico en pantalla.
    Function("diagnosticoAudio") { () -> String in
      let s = AVAudioSession.sharedInstance()
      let corto = { (v: String) in
        v.replacingOccurrences(of: "AVAudioSessionCategory", with: "")
          .replacingOccurrences(of: "AVAudioSessionMode", with: "")
          .replacingOccurrences(of: "AVAudioSessionPort", with: "")
      }
      let ent = s.currentRoute.inputs.map { corto($0.portType.rawValue) }.joined(separator: "+")
      let sal = s.currentRoute.outputs.map { corto($0.portType.rawValue) }.joined(separator: "+")
      var modoMic = "-"
      if #available(iOS 15.0, *) { modoMic = "\(AVCaptureDevice.activeMicrophoneMode.rawValue)" }
      return [
        "cat=\(corto(s.category.rawValue))",
        "modo=\(corto(s.mode.rawValue))",
        "opc=\(s.categoryOptions.rawValue)",
        "ent=\(ent.isEmpty ? "-" : ent)",
        "sal=\(sal.isEmpty ? "-" : sal)",
        "micDisp=\(s.isInputAvailable)",
        "hz=\(Int(s.sampleRate))",
        "micModo=\(modoMic)",
        "voz=\(self.modoVoz) alt=\(self.altavoz)",
      ].joined(separator: " ")
    }

    // Por dónde sale ahora el sonido: "cascos", "auricular" o "altavoz".
    Function("rutaSalida") { () -> String in
      return self.rutaSalida()
    }

    // Radio entra/sale de voz: la sesión pasa a playAndRecord + voiceChat
    // (procesado de voz del sistema: cancelación de eco, supresión de ruido)
    // o vuelve a solo reproducción.
    Function("modoVoz") { (activo: Bool) -> Void in
      self.modoVoz = activo
      _ = self.configureAudioSession()
      // Con Radio activa, el bucle silencioso mantiene la app viva con la
      // pantalla bloqueada aunque nadie hable (si iOS ve la sesión parada,
      // suspende la app y se cortan voz y red).
      if activo { self.startKeepAlive() }
    }

    // Abre el panel del sistema para elegir el modo de micro (Aislamiento de
    // voz, Estándar, Espectro amplio). iOS no deja a la app activarlo por su
    // cuenta; sí mostrar el selector. iOS 15+.
    AsyncFunction("mostrarModosMicro") { () -> Void in
      if #available(iOS 15.0, *) {
        AVCaptureDevice.showSystemUserInterface(.microphoneModes)
      }
    }.runOnQueue(.main)

    // Modo de micro activo: "aislamiento", "estandar", "amplio" o "".
    Function("modoMicro") { () -> String in
      if #available(iOS 15.0, *) {
        switch AVCaptureDevice.activeMicrophoneMode {
        case .voiceIsolation: return "aislamiento"
        case .wideSpectrum: return "amplio"
        case .standard: return "estandar"
        @unknown default: return ""
        }
      }
      return ""
    }

    // El keep-alive ya NO arranca en OnCreate. La capa JS lo activa con
    // `start()` solo cuando hay una fuente conectada y lo para con `stop()`
    // al desconectar, para que iOS pueda suspender la app (y dormir la radio
    // WiFi) cuando no estás en una carrera. Esto reduce mucho el consumo.

    // Activa la sesión de audio + el loop silente. Idempotente.
    Function("start") { () -> Bool in
      let ok = self.configureAudioSession()
      self.startKeepAlive()
      return ok
    }

    // Para la voz y libera la sesión de audio para que iOS suspenda la app.
    // Usar al desconectar de la carrera.
    Function("stop") { () -> Void in
      self.synth.stopSpeaking(at: .immediate)
      self.callarAmplificada()
      // Con Radio activa NO se libera la sesión: la usa la voz y, desactivada,
      // iOS suspendía la app en cuanto se bloqueaba la pantalla.
      if !self.modoVoz { self.stopKeepAlive() }
    }

    // Interrumpe solo el habla en curso, manteniendo viva la sesión.
    Function("shutUp") { () -> Void in
      self.synth.stopSpeaking(at: .immediate)
      self.callarAmplificada()
    }

    Function("speak") { (text: String, language: String, rate: Double) -> String in
      let ok = self.configureAudioSession()
      // Asegurar que el keep-alive sigue corriendo mientras hablamos.
      if !(self.keepAlivePlayer?.isPlaying ?? false) {
        self.startKeepAlive()
      }
      if self.modoVoz {
        self.hablarAmplificada(text, language: language, rate: rate)
      } else {
        self.synth.speak(self.frase(text, language: language, rate: rate))
      }
      return ok ? "ok" : "session-failed"
    }

    Function("getStatus") { () -> String in
      let session = AVAudioSession.sharedInstance()
      return [
        "started=\(self.started)",
        "playing=\(self.keepAlivePlayer?.isPlaying ?? false)",
        "vol=\(self.keepAlivePlayer?.volume ?? -1)",
        "cat=\(session.category.rawValue)",
        "mode=\(session.mode.rawValue)",
        "other=\(session.isOtherAudioPlaying)",
      ].joined(separator: ", ")
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private func frase(_ text: String, language: String, rate: Double) -> AVSpeechUtterance {
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = self.vozPara(language)
    utterance.rate = Float(rate)
    utterance.volume = 1.0
    return utterance
  }

  /// Radio: sintetiza la frase a memoria, la amplifica y la reproduce. Si algo
  /// falla, cae a la locución normal (más baja, pero se oye).
  private func hablarAmplificada(_ text: String, language: String, rate: Double) {
    DispatchQueue.main.async {
      let gen = self.generacion
      var trozos: [AVAudioPCMBuffer] = []
      var terminado = false
      self.synthRadio.write(self.frase(text, language: language, rate: rate)) { [weak self] buffer in
        guard let self = self, !terminado else { return }
        if let pcm = buffer as? AVAudioPCMBuffer, pcm.frameLength > 0 {
          trozos.append(pcm)
          return
        }
        // Buffer vacío = fin de la frase.
        terminado = true
        let audio = Amplificador.procesar(trozos)
        DispatchQueue.main.async {
          guard gen == self.generacion else { return }
          if let audio = audio, self.reproducir(audio, gen: gen) { return }
          NSLog("[BackgroundTts] amplificada falló; locución normal")
          self.synth.speak(self.frase(text, language: language, rate: rate))
        }
      }
    }
  }

  /// Encola el audio en el motor. Hilo principal.
  private func reproducir(_ audio: AVAudioPCMBuffer, gen: Int) -> Bool {
    if reproductor.engine == nil { motor.attach(reproductor) }
    if formatoMotor != audio.format {
      // Cambio de formato (otra voz): reconectar con el motor parado.
      if motor.isRunning { reproductor.stop(); motor.stop() }
      motor.connect(reproductor, to: motor.mainMixerNode, format: audio.format)
      formatoMotor = audio.format
    }
    if !motor.isRunning {
      // Se para solo al cambiar la ruta (cascos) o tras una interrupción.
      do {
        motor.prepare()
        try motor.start()
      } catch {
        NSLog("[BackgroundTts] motor de audio no arranca: \(error)")
        return false
      }
    }
    amplificadasSonando += 1
    delegado.empezada()
    reproductor.scheduleBuffer(audio, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self = self, gen == self.generacion else { return }
        self.amplificadasSonando = max(0, self.amplificadasSonando - 1)
        self.delegado.terminada()
      }
    }
    if !reproductor.isPlaying { reproductor.play() }
    return true
  }

  /// Corta la locución amplificada en curso y la que esté por llegar.
  private func callarAmplificada() {
    DispatchQueue.main.async {
      self.generacion += 1
      self.synthRadio.stopSpeaking(at: .immediate)
      if self.reproductor.engine != nil { self.reproductor.stop() }
      while self.amplificadasSonando > 0 {
        self.amplificadasSonando -= 1
        self.delegado.terminada()
      }
    }
  }

  private func rutaSalida() -> String {
    let cascos: [AVAudioSession.Port] = [
      .headphones, .bluetoothHFP, .bluetoothA2DP, .bluetoothLE, .usbAudio, .carAudio,
    ]
    let salidas = AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType }
    if salidas.contains(where: { cascos.contains($0) }) { return "cascos" }
    if salidas.contains(.builtInSpeaker) { return "altavoz" }
    return "auricular"
  }

  // Voz del idioma pedido; si el sistema no la tiene, otra del mismo idioma
  // (p. ej. pt-BR por pt-PT) y, en último caso, castellano. iOS no trae voz
  // en euskera: sin esta reserva hablaría con la voz del idioma del sistema.
  private func vozPara(_ language: String) -> AVSpeechSynthesisVoice? {
    if let v = AVSpeechSynthesisVoice(language: language) { return v }
    let base = language.split(separator: "-").first.map(String.init) ?? language
    if let v = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language.hasPrefix(base + "-") }) {
      return v
    }
    return AVSpeechSynthesisVoice(language: "es-ES")
  }

  private func configureAudioSession() -> Bool {
    let session = AVAudioSession.sharedInstance()
    do {
      if modoVoz {
        // Radio con voz: micro + altavoz en la misma sesión, con el
        // procesado de voz del sistema (modo voiceChat). Sin
        // .defaultToSpeaker: sin cascos el audio sale por el auricular del
        // móvil, no por el altavoz, y así no hay acople con el micro abierto.
#if compiler(>=6.2)
        var opciones: AVAudioSession.CategoryOptions = [.mixWithOthers, .allowBluetoothHFP]
#else
        var opciones: AVAudioSession.CategoryOptions = [.mixWithOthers, .allowBluetooth]
#endif
        if altavoz { opciones.insert(.defaultToSpeaker) }
        // Solo se reconfigura si algo cambia: hacerlo en cada locución con la
        // voz en marcha podía interrumpir la captura del micro de WebRTC.
        if session.category != .playAndRecord || session.mode != .voiceChat || session.categoryOptions != opciones {
          try session.setCategory(.playAndRecord, mode: .voiceChat, options: opciones)
        }
        try session.setActive(true, options: [])
        return true
      }
      // .playback + .default (sin .spokenAudio que es transient).
      // Sin .duckOthers para evitar que iOS lo trate como audio efímero.
      try session.setCategory(.playback, mode: .default, options: [])
      try session.setActive(true, options: [])
      return true
    } catch {
      NSLog("[BackgroundTts] AVAudioSession setup failed: \(error)")
      return false
    }
  }

  // Arranca (o re-arranca) el loop silente. El player se crea una vez de
  // forma perezosa y luego se reusa en sucesivos start/stop.
  private func startKeepAlive() {
    if keepAlivePlayer == nil {
      // Generar WAV silente de 1s y escribirlo a disco temporal — usamos
      // AVAudioPlayer en vez de AVAudioPlayerNode porque iOS lo trata
      // como "media playback" estable que no se suspende.
      guard let url = self.writeSilentWavToTemp() else {
        NSLog("[BackgroundTts] could not write keep-alive wav")
        return
      }
      do {
        let player = try AVAudioPlayer(contentsOf: url)
        player.numberOfLoops = -1  // infinite
        // Silencio total. iOS sigue considerando la sesión "playback"
        // activa mientras el player esté en loop, así que la app no se
        // suspende en background aunque las muestras sean 0.
        player.volume = 0.0
        player.prepareToPlay()
        self.keepAlivePlayer = player
      } catch {
        NSLog("[BackgroundTts] keep-alive player failed: \(error)")
        return
      }
    }
    if !(keepAlivePlayer?.isPlaying ?? false) {
      keepAlivePlayer?.play()
    }
    started = true
    NSLog("[BackgroundTts] keep-alive started")
  }

  // Para el loop silente y libera la sesión de audio. A partir de aquí iOS
  // puede suspender la app en background (no más drenaje de batería).
  private func stopKeepAlive() {
    keepAlivePlayer?.pause()
    started = false
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
    } catch {
      NSLog("[BackgroundTts] deactivate session failed: \(error)")
    }
    NSLog("[BackgroundTts] keep-alive stopped")
  }

  // Genera 1s de WAV mono 16-bit 44100Hz con un tono muy bajo
  // (40Hz amplitud 0.05). Escribe a temp y devuelve la URL.
  private func writeSilentWavToTemp() -> URL? {
    let sampleRate: Int = 44100
    let seconds = 1
    let numSamples = sampleRate * seconds
    let dataSize = numSamples * 2  // 16-bit mono
    let headerSize = 44

    var data = Data(capacity: headerSize + dataSize)
    func writeU32(_ v: UInt32) {
      var le = v.littleEndian; withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }
    func writeU16(_ v: UInt16) {
      var le = v.littleEndian; withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }
    func writeStr(_ s: String) {
      data.append(s.data(using: .ascii)!)
    }

    writeStr("RIFF")
    writeU32(UInt32(36 + dataSize))
    writeStr("WAVE")
    writeStr("fmt ")
    writeU32(16)               // fmt chunk size
    writeU16(1)                // PCM
    writeU16(1)                // mono
    writeU32(UInt32(sampleRate))
    writeU32(UInt32(sampleRate * 2))  // byte rate
    writeU16(2)                // block align
    writeU16(16)               // bits per sample
    writeStr("data")
    writeU32(UInt32(dataSize))

    // Silencio puro: todas las muestras a 0.
    for _ in 0..<numSamples {
      var le: Int16 = 0
      withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
    }

    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("bgtts-silent-v2.wav")
    do {
      try data.write(to: url)
      return url
    } catch {
      NSLog("[BackgroundTts] write temp wav failed: \(error)")
      return nil
    }
  }
}
