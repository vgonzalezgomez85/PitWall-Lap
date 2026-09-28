Pod::Spec.new do |s|
  s.name           = 'InfolapWs'
  s.version        = '1.0.0'
  s.summary        = 'WebSocket TLS client for the TicTac InfoLap server.'
  s.description    = 'URLSessionWebSocketTask that accepts the self-signed certificate of the TicTac InfoLap server.'
  s.author         = 'PitWall'
  s.homepage       = 'https://example.com'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
