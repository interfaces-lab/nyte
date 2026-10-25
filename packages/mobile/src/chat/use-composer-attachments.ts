// oxlint-disable-next-line no-restricted-imports -- the attachments menu springs shut when the suggestion menu opens
import { useEffect, useState } from "react";
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

/** Spring the attachments menu shut, then unmount it once the spring settles. */
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

/**
 * The photos staged on the composer and the attachments menu that adds them. `blocked` is true while
 * another step holds the composer (sending, choosing a model); staging photos holds it too, and
 * `onStaging` reports that to the screen. The menu closes whenever the suggestion menu opens. A sent
 * photo is withdrawn from the strip at once but keeps its marks until `release`, so a refused message
 * can be restored whole.
 */
export function useComposerAttachments({
  blocked,
  suggesting,
  geometry,
  reportError,
  onStaging,
}: {
  blocked: boolean;
  suggesting: boolean;
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

  useEffect(() => {
    if (suggesting) springShut(progress, extend, setVisible);
  }, [suggesting, progress, extend]);

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
