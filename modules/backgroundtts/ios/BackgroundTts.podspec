Pod::Spec.new do |s|
  s.name           = 'BackgroundTts'
  s.version        = '1.0.0'
  s.summary        = 'Background-friendly TTS module for SlotTime mobile.'
  s.description    = 'AVSpeechSynthesizer wrapper that activates AVAudioSession for background playback.'
  s.author         = 'SlotTime'
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
