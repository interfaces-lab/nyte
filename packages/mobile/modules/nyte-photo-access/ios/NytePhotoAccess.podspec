Pod::Spec.new do |s|
  s.name = 'NytePhotoAccess'
  s.version = '1.0.0'
  s.summary = 'Completion-aware limited photo access for Nyte.'
  s.description = 'Resolves the limited-library picker operation after its native dismissal.'
  s.license = 'MIT'
  s.author = 'Nyte'
  s.homepage = 'https://github.com/interfaces-lab/nyte'
  s.source = { git: 'https://github.com/interfaces-lab/nyte.git' }
  s.platforms = { ios: '17.0' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = ['Photos', 'PhotosUI']
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
