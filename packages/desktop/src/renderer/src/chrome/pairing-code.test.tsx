import assert from "node:assert/strict";
import { test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PairingCode, pairingPayload } from "./pairing-code.tsx";

test("the payload is the link the iOS connect screen parses", () => {
  assert.equal(
    pairingPayload({ address: "http://127.0.0.1:53211", token: "abc/def+ghi=" }),
    "nyte://connect?url=http%3A%2F%2F127.0.0.1%3A53211&token=abc%2Fdef%2Bghi%3D",
  );
});

test("a new share draws a new code instead of the previous token's", () => {
  const first = renderToStaticMarkup(
    <PairingCode
      value={pairingPayload({ address: "http://127.0.0.1:1", token: "first" })}
      size={120}
    />,
  );
  const second = renderToStaticMarkup(
    <PairingCode
      value={pairingPayload({ address: "http://127.0.0.1:1", token: "second" })}
      size={120}
    />,
  );
  assert.notEqual(first, second);
});
