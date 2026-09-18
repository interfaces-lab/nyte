import { createNyteClient, NyteTransportError, NyteWireError } from "@nyte-ai/client";
import type { ServerInfo } from "@nyte-ai/protocol";
import { describe, expect, it } from "vitest";
import {
  describeHostError,
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

  it("allows plain HTTP only for numeric private ranges, not look-alike hostnames", () => {
    const token = "abcdefghijklmnop";
    expect(parseConnection({ name: "m", url: "http://192.168.1.20:8787", token }).url).toBe(
      "http://192.168.1.20:8787",
    );
    expect(() => parseConnection({ name: "m", url: "http://10.example.com", token })).toThrow(
      /HTTPS/,
    );
    expect(() => parseConnection({ name: "m", url: "http://172.32.0.1", token })).toThrow(/HTTPS/);
    expect(() => parseConnection({ name: "m", url: "127.0.0.1:8787", token })).toThrow(/http:\/\//);
    expect(parseConnection({ name: "m", url: "https://mac.example", token }).url).toBe(
      "https://mac.example",
    );
  });

  it("accepts the Tailscale range over plain HTTP but not its neighbours", () => {
    const token = "abcdefghijklmnop";
    expect(parseConnection({ name: "m", url: "http://100.126.254.2:8787", token }).url).toBe(
      "http://100.126.254.2:8787",
    );
    expect(parseConnection({ name: "m", url: "http://100.64.0.1:1", token }).url).toBe(
      "http://100.64.0.1:1",
    );
    expect(parseConnection({ name: "m", url: "http://100.127.255.254:1", token }).url).toBe(
      "http://100.127.255.254:1",
    );
    // 100.64.0.0/10 stops at 100.127; the ranges either side are ordinary public space.
    expect(() => parseConnection({ name: "m", url: "http://100.63.255.255:1", token })).toThrow(
      /HTTPS/,
    );
    expect(() => parseConnection({ name: "m", url: "http://100.128.0.1:1", token })).toThrow(
      /HTTPS/,
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

  it("removes empty query and fragment delimiters before client routes are appended", async () => {
    for (const suffix of ["?", "#", "?#"]) {
      const connection = parseConnection({
        name: "My Mac",
        url: `https://mac.example/nyte/${suffix}`,
        token: "t",
      });
      const requests: string[] = [];
      const client = createNyteClient({
        baseUrl: connection.url,
        token: connection.token,
        fetch: async (input) => {
          requests.push(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          );
          return Response.json({
            ok: true,
            defined: true,
            value: {
              version: "test",
              wireVersion: 1,
              host: { kind: "unspecified" },
            } satisfies ServerInfo,
          });
        },
      });
      await client.info();
      expect(requests).toEqual(["https://mac.example/nyte/v1/info"]);
    }
  });
});

describe("parseConnectionPayload", () => {
  it("reads the pairing link a desktop QR code carries", () => {
    const link = `nyte://connect?name=${encodeURIComponent("Kim's Mac")}&url=${encodeURIComponent("http://192.168.1.20:8787")}&token=abcdefghijklmnop`;
    expect(parseConnectionPayload(` ${link} `)).toEqual({
      name: "Kim's Mac",
      url: "http://192.168.1.20:8787",
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

describe("describeHostError", () => {
  it("names the fix for refused tokens and unreachable hosts", () => {
    expect(
      describeHostError(new NyteWireError({ code: "unauthorized", message: "no" }, 401)),
    ).toMatch(/Settings › Server/);
    expect(describeHostError(new NyteTransportError({ kind: "network", cause: null }))).toMatch(
      /sharing/,
    );
    expect(describeHostError(new NyteTransportError({ kind: "bad_status", status: 404 }))).toMatch(
      /not as a Nyte server/,
    );
  });

  it("names the version difference when the Mac does not serve an operation", () => {
    expect(
      describeHostError(new NyteWireError({ code: "unknown_operation", message: "no" }, 404)),
    ).toMatch(/older Nyte/);
  });
});
