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

public class BackgroundTtsModule: Module {
  private let synth = AVSpeechSynthesizer()
  private var keepAlivePlayer: AVAudioPlayer?
  private var started = false

  public func definition() -> ModuleDefinition {
    Name("BackgroundTts")

    OnCreate {
      _ = self.configureAudioSession()
      self.startKeepAlive()
    }

    Function("speak") { (text: String, language: String, rate: Double) -> String in
      let ok = self.configureAudioSession()
      // Asegurar que el keep-alive sigue corriendo.
      if !(self.keepAlivePlayer?.isPlaying ?? false) {
        self.keepAlivePlayer?.play()
      }
      let utterance = AVSpeechUtterance(string: text)
      utterance.voice = AVSpeechSynthesisVoice(language: language)
      utterance.rate = Float(rate)
      self.synth.speak(utterance)
      return ok ? "ok" : "session-failed"
    }

    Function("stop") { () -> Void in
      self.synth.stopSpeaking(at: .immediate)
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

  private func configureAudioSession() -> Bool {
    let session = AVAudioSession.sharedInstance()
    do {
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

  private func startKeepAlive() {
    if started { return }
    started = true

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
      player.play()
      self.keepAlivePlayer = player
      NSLog("[BackgroundTts] keep-alive player started")
    } catch {
      NSLog("[BackgroundTts] keep-alive player failed: \(error)")
    }
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
