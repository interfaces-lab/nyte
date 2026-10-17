import { requireNativeModule } from "expo";

export const photoAccess = requireNativeModule<{
  presentLimitedPicker(): Promise<void>;
}>("NytePhotoAccess");
