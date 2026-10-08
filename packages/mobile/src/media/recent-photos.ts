/**
 * The photos the composer offers without leaving the screen, resolved to files
 * the attachment pipeline can read. Access can be partial on iOS, so the caller
 * gets the grant alongside the photos and can offer the system picker for more.
 */
import {
  AssetField,
  getPermissionsAsync,
  MediaType,
  Query,
  requestPermissionsAsync,
  type PermissionResponse,
} from "expo-media-library";
import { prepareImage, type StagedImage } from "./attachments.ts";
import { photoAccess } from "../../modules/nyte-photo-access/src/nyte-photo-access.ts";

export type RecentPhoto = { readonly id: string; readonly uri: string };

export type PhotoAccess =
  | { readonly kind: "granted"; readonly photos: readonly RecentPhoto[] }
  | { readonly kind: "limited"; readonly photos: readonly RecentPhoto[] }
  | { readonly kind: "denied" };

export async function readRecentPhotos(limit: number): Promise<PhotoAccess> {
  const permission: PermissionResponse = await getPermissionsAsync(false, ["photo"]);

  if (!permission.granted) return { kind: "denied" };

  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(limit)
    .exe();

  const photos = await Promise.all(
    assets.map(async (asset) => ({ id: asset.id, uri: await asset.getUri() })),
  );

  return permission.accessPrivileges === "limited"
    ? { kind: "limited", photos }
    : { kind: "granted", photos };
}

export async function requestPhotoAccess(limit: number): Promise<PhotoAccess> {
  await requestPermissionsAsync(false, ["photo"]);

  return readRecentPhotos(limit);
}

export const chooseSharedPhotos = () => photoAccess.presentLimitedPicker();

export const stageRecentPhoto = (photo: RecentPhoto): Promise<StagedImage> =>
  prepareImage(photo.uri);
