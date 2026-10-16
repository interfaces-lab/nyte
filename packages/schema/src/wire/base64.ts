import { Type } from "typebox";

export const base64Bytes = Type.Codec(
  Type.String({ pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }),
)
  .Decode((value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))
  .Encode((bytes) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")));
