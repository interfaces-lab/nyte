import { useState } from "react";
import { useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { MAX_ATTACHMENTS, type StagedImage } from "../media/attachments.ts";
import { clearAnnotation } from "../media/annotations.ts";
import {
  chooseSharedPhotos,
  readRecentPhotos,
  requestPhotoAccess,
  stageRecentPhoto,
  type PhotoAccess,
  type RecentPhoto,
} from "../media/recent-photos.ts";
import { useAttachmentFlight } from "./attachment-flight.ts";
import { SPRING } from "./composer-geometry.ts";

const PHOTO_PAGE = 24;

function springShut(
  progress: SharedValue<number>,
  extend: SharedValue<number>,
  setVisible: (visible: boolean) => void,
) {
  extend.set(withSpring(0, SPRING.open));
  progress.set(
    withSpring(0, SPRING.open, (finished) => {
      "worklet";

      if (finished) {
        extend.set(0);
        scheduleOnRN(setVisible, false);
      }
    }),
  );
}

export function useComposerAttachments({
  blocked,
  geometry,
  reportError,
  onStaging,
}: {
  blocked: boolean;
  geometry: Omit<Parameters<typeof useAttachmentFlight>[0], "close">;
  reportError: (message: string | undefined) => void;
  onStaging: ((staging: boolean) => void) | undefined;
}) {
  const [images, setImages] = useState<StagedImage[]>([]);
  const [visible, setVisible] = useState(false);
  const [access, setAccess] = useState<PhotoAccess>();
  const [staging, setStaging] = useState(false);
  const progress = useSharedValue(0);
  const extend = useSharedValue(0);
  const flight = useAttachmentFlight({ ...geometry, close: () => setVisible(false) });
  const remaining = MAX_ATTACHMENTS - images.length;
  const disabled = blocked || staging || remaining <= 0;

  const loadPhotos = () =>
    readRecentPhotos(PHOTO_PAGE)
      .then(setAccess)
      .catch(() => setAccess({ kind: "denied" }));

  const prepare = async (photos: readonly RecentPhoto[]): Promise<readonly StagedImage[]> => {
    if (disabled) return [];
    setStaging(true);
    onStaging?.(true);
    reportError(undefined);

    return Promise.all(photos.slice(0, remaining).map(stageRecentPhoto))
      .catch((cause: unknown) => {
        reportError(cause instanceof Error ? cause.message : "Couldn't attach photo.");
        throw cause;
      })
      .finally(() => {
        setStaging(false);
        onStaging?.(false);
      });
  };

  return {
    images,
    visible,
    access,
    staging,
    disabled,
    remaining,
    progress,
    extend,
    flight,
    open: () => {
      if (disabled) return;

      flight.reset();
      extend.set(0);
      progress.set(0);
      setVisible(true);
      reportError(undefined);
    },
    close: () => springShut(progress, extend, setVisible),
    loadPhotos,
    requestPhotos: async () => {
      setAccess(await requestPhotoAccess(PHOTO_PAGE));
    },
    manageAccess: async () => {
      await chooseSharedPhotos();
      await loadPhotos();
    },
    prepare,
    add: (added: readonly StagedImage[]) =>
      setImages((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS)),
    restore: (restored: readonly StagedImage[]) =>
      setImages((current) => [...restored, ...current]),
    remove: (id: string) => {
      clearAnnotation(id);
      setImages((current) => current.filter((item) => item.id !== id));
    },
    withdraw: (submitted: readonly StagedImage[]) =>
      setImages((current) => current.filter((image) => !submitted.includes(image))),
    release: (submitted: readonly StagedImage[]) => {
      for (const image of submitted) clearAnnotation(image.id);
    },
  };
}
