import assert from "node:assert/strict";
import { test } from "vitest";
import { presentTranscriptNotice } from "./transcript-presentation.ts";

test("provider notices find nested messages and ignore unrelated JSON values", () => {
  const source =
    'Error: {"message":false,"error":{"cause":{"message":"Provider rejected the request"}}}';
  assert.deepEqual(presentTranscriptNotice(source), {
    text: "Provider rejected the request",
    tone: "danger",
    detail: source,
  });
  assert.equal(
    presentTranscriptNotice('Error: {"error":null,"cause":{"message":"Try a different model"}}')
      .text,
    "Try a different model",
  );
  assert.equal(
    presentTranscriptNotice('Error: {"message":42,"error":[],"cause":false}').text,
    "Request failed.",
  );
  assert.equal(presentTranscriptNotice('Error: {"error":}').text, "Request failed.");
});
