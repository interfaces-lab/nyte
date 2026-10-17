import ExpoModulesCore
import Photos
import PhotosUI

public final class NytePhotoAccessModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NytePhotoAccess")

    AsyncFunction("presentLimitedPicker") { (promise: Promise) in
      guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited else {
        promise.resolve()
        return
      }
      guard let controller = appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_PHOTO_PRESENTER", "The photo picker has no presenting view controller.")
        return
      }
      PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: controller) { _ in
        promise.resolve()
      }
    }.runOnQueue(.main)
  }
}
