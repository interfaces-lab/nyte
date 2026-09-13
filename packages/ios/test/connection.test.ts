import { createNyteClient, NyteTransportError, NyteWireError } from "@nyte-ai/client";
import type { ServerInfo } from "@nyte-ai/protocol";
import { describe, expect, it } from "vitest";
import {
  describeHostError,
  displayAddress,
  parseConnection,
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
});
