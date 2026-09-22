/**
 * The photos the composer offers without leaving the screen, resolved to files
 * the attachment pipeline can read. Access can be partial on iOS, so the caller
 * gets the grant alongside the photos and can offer the system picker for more.
 */
import {
  AssetField,
  MediaType,
  presentPermissionsPicker,
  Query,
  requestPermissionsAsync,
  type PermissionResponse,
} from "expo-media-library";
import { prepareImage, type StagedImage } from "./attachments.ts";

export type RecentPhoto = { readonly id: string; readonly uri: string };

export type PhotoAccess =
  | { readonly kind: "granted"; readonly photos: readonly RecentPhoto[] }
  | { readonly kind: "limited"; readonly photos: readonly RecentPhoto[] }
  | { readonly kind: "denied" };

export async function readRecentPhotos(limit: number): Promise<PhotoAccess> {
  const permission: PermissionResponse = await requestPermissionsAsync();

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

export const chooseSharedPhotos = () => presentPermissionsPicker(["photo"]);

export const stageRecentPhoto = (photo: RecentPhoto): Promise<StagedImage> =>
  prepareImage(photo.uri);
