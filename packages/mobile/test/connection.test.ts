import { describe, expect, it } from "vitest";
import {
  displayAddress,
  parseConnection,
  parseConnectionPayload,
} from "../src/connection/connection.ts";

describe("parseConnection", () => {
  it("accepts the loopback address the desktop simulator connection shows", () => {
    const connection = parseConnection({
      name: " My Mac ",
      url: " http://127.0.0.1:53211/ ",
      token: "abcdefghijklmnop ",
    });
    expect(connection).toEqual({
      name: "My Mac",
      url: "http://127.0.0.1:53211",
      token: "abcdefghijklmnop",
    });
    expect(displayAddress(connection)).toBe("127.0.0.1:53211");
  });

  it("allows plain HTTP only to loopback, not to LAN or Tailscale addresses", () => {
    const token = "abcdefghijklmnop";
    expect(parseConnection({ name: "m", url: "http://localhost:8787", token }).url).toBe(
      "http://localhost:8787",
    );
    expect(parseConnection({ name: "m", url: "http://[::1]:8787", token }).url).toBe(
      "http://[::1]:8787",
    );
    for (const url of [
      "http://192.168.1.20:8787",
      "http://10.0.0.2",
      "http://172.16.0.1",
      "http://mac.local:8787",
      "http://100.126.254.2:8787",
      "http://mac.tail1234.ts.net",
      "http://127.example.com",
    ]) {
      expect(() => parseConnection({ name: "m", url, token })).toThrow(/HTTPS/);
    }
    expect(() => parseConnection({ name: "m", url: "127.0.0.1:8787", token })).toThrow(
      /https:\/\//,
    );
    expect(parseConnection({ name: "m", url: "https://mac.tail1234.ts.net", token }).url).toBe(
      "https://mac.tail1234.ts.net",
    );
  });

  it("keeps the token out of the address", () => {
    expect(() =>
      parseConnection({ name: "m", url: "http://user:secret@127.0.0.1:1", token: "t" }),
    ).toThrow(/token has its own field/);
    expect(() =>
      parseConnection({ name: "m", url: "http://127.0.0.1:1/?token=t", token: "t" }),
    ).toThrow(/token has its own field/);
    expect(() =>
      parseConnection({ name: "m", url: "https://mac.example/#token=t", token: "t" }),
    ).toThrow(/token has its own field/);
  });

  it("removes empty query and fragment delimiters before the sdk appends its routes", () => {
    for (const suffix of ["?", "#", "?#"]) {
      const connection = parseConnection({
        name: "My Mac",
        url: `https://mac.example/nyte/${suffix}`,
        token: "t",
      });
      expect(connection.url).toBe("https://mac.example/nyte");
    }
  });
});

describe("parseConnectionPayload", () => {
  it("reads the pairing link a desktop QR code carries", () => {
    const link = `nyte://connect?name=${encodeURIComponent("Kim's Mac")}&url=${encodeURIComponent("https://mac.tail1234.ts.net")}&token=abcdefghijklmnop`;
    expect(parseConnectionPayload(` ${link} `)).toEqual({
      name: "Kim's Mac",
      url: "https://mac.tail1234.ts.net",
      token: "abcdefghijklmnop",
    });
  });

  it("names the host when the code omits one", () => {
    expect(
      parseConnectionPayload("nyte://connect?url=https://mac.example&token=abcdefghijklmnop").name,
    ).toBe("My Mac");
  });

  it("refuses codes that are not Nyte pairings", () => {
    for (const text of ["https://example.com", "nyte://chat/session_1", "not a url", ""]) {
      expect(() => parseConnectionPayload(text)).toThrow(/isn't a Nyte connection/);
    }
    expect(() => parseConnectionPayload("nyte://connect?url=https://mac.example")).toThrow(
      /missing the address or the token/,
    );
  });

  it("holds a scanned address to the same policy as a typed one", () => {
    expect(() =>
      parseConnectionPayload("nyte://connect?url=http://93.184.216.34&token=abcdefghijklmnop"),
    ).toThrow(/HTTPS/);
  });
});
