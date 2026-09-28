// Cliente WebSocket TLS para el servidor InfoLap del TicTac nuevo.
//
// El TicTac abre `wss://<pc>:12543/` con un certificado autofirmado
// (CN=InfoLapServer) que genera en cada instalación, así que no se puede
// fijar de antemano. El WebSocket de React Native lo rechaza; este módulo
// usa su propia URLSession que acepta ese certificado. La confianza
// permisiva vive SOLO en esta sesión: el resto de la app no se ve afectado.
// (ATS no aplica a conexiones por IP, que es como se llega al TicTac.)

import ExpoModulesCore
import Foundation

public class InfolapWsModule: Module {
  private let lock = NSLock()
  private var tasks: [Int: URLSessionWebSocketTask] = [:]
  private lazy var delegate = InfolapWsDelegate(module: self)
  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 3
    return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
  }()

  public func definition() -> ModuleDefinition {
    Name("InfolapWs")

    Events("onOpen", "onMessage", "onClose", "onError")

    // Abre la conexión `id`. Los eventos llevan ese id para que la capa JS
    // descarte los de conexiones anteriores.
    Function("connect") { (id: Int, url: String) -> Void in
      guard let u = URL(string: url) else {
        self.sendEvent("onError", ["id": id, "message": "invalid-url"])
        return
      }
      let task = self.session.webSocketTask(with: u)
      task.taskDescription = String(id)
      let old = self.swap(id, task)
      old?.cancel(with: .goingAway, reason: nil)
      task.resume()
      self.receive(id, task)
    }

    Function("close") { (id: Int) -> Void in
      if let task = self.swap(id, nil) {
        task.cancel(with: .normalClosure, reason: nil)
      }
    }

    OnDestroy {
      self.lock.lock()
      let all = Array(self.tasks.values)
      self.tasks.removeAll()
      self.lock.unlock()
      for t in all { t.cancel(with: .goingAway, reason: nil) }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  @discardableResult
  private func swap(_ id: Int, _ task: URLSessionWebSocketTask?) -> URLSessionWebSocketTask? {
    lock.lock(); defer { lock.unlock() }
    let old = tasks[id]
    tasks[id] = task
    return old
  }

  /// true si `task` sigue siendo la conexión vigente de `id` (y la retira
  /// si `remove`), para no emitir eventos de conexiones ya sustituidas.
  fileprivate func isCurrent(_ id: Int, _ task: URLSessionTask, remove: Bool = false) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard let cur = tasks[id], cur === task else { return false }
    if remove { tasks[id] = nil }
    return true
  }

  private func receive(_ id: Int, _ task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .success(let message):
        guard self.isCurrent(id, task) else { return }
        switch message {
        case .string(let text):
          self.sendEvent("onMessage", ["id": id, "data": text])
        case .data(let data):
          self.sendEvent("onMessage", ["id": id, "data": String(decoding: data, as: UTF8.self)])
        @unknown default:
          break
        }
        self.receive(id, task)
      case .failure(let error):
        if self.isCurrent(id, task, remove: true) {
          self.sendEvent("onError", ["id": id, "message": error.localizedDescription])
        }
      }
    }
  }

  fileprivate func didOpen(_ task: URLSessionTask) {
    guard let id = Int(task.taskDescription ?? ""), isCurrent(id, task) else { return }
    sendEvent("onOpen", ["id": id])
  }

  fileprivate func didClose(_ task: URLSessionTask, code: Int, reason: String) {
    guard let id = Int(task.taskDescription ?? ""), isCurrent(id, task, remove: true) else { return }
    sendEvent("onClose", ["id": id, "code": code, "reason": reason])
  }
}

private final class InfolapWsDelegate: NSObject, URLSessionWebSocketDelegate {
  private weak var module: InfolapWsModule?

  init(module: InfolapWsModule) {
    self.module = module
  }

  // Acepta el certificado autofirmado del TicTac (ver cabecera).
  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
       let trust = challenge.protectionSpace.serverTrust {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.performDefaultHandling, nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    module?.didOpen(webSocketTask)
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    let text = reason.map { String(decoding: $0, as: UTF8.self) } ?? ""
    module?.didClose(webSocketTask, code: closeCode.rawValue, reason: text)
  }
}
