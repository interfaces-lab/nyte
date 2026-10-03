import { PhotonImage, SamplingFilter, fliph, flipv, resize } from "@cf-wasm/photon/node";

export type PhotonImageType = PhotonImage;

const photon = { PhotonImage, SamplingFilter, fliph, flipv, resize };

export function loadPhoton() {
  return Promise.resolve(photon);
}
