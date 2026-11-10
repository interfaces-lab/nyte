import { describe, expect, test } from "vitest";
import {
  formatProviderError,
  MAX_PROVIDER_ERROR_BODY_CHARS,
  normalizeProviderError,
} from "../src/utils/error-body.ts";

class SdkHttpResponseBody {
  locked = false;
  state = { storedError: undefined };
}

class SdkInnerError {
  code = "EPROTO";
  internalState = {};
}

describe("normalizeProviderError", () => {
  test.each([
    {
      name: "extracts status and body from a Mistral-shaped error",
      error: Object.assign(new Error("Mistral request failed"), {
        statusCode: 403,
        body: '{"error":"blocked by gateway WAF"}',
      }),
      expected: {
        status: 403,
        body: '{"error":"blocked by gateway WAF"}',
        messageCarriesBody: false,
      },
    },
    {
      name: "extracts status and body from a Bedrock-shaped ServiceException",
      error: Object.assign(new Error("UnknownError"), {
        name: "UnknownError",
        $metadata: { httpStatusCode: 403 },
        $response: { statusCode: 403, body: '{"message":"blocked by gateway WAF"}' },
      }),
      expected: {
        status: 403,
        body: '{"message":"blocked by gateway WAF"}',
        messageCarriesBody: false,
      },
    },
    {
      name: "ignores a Bedrock response stream instead of serializing its internals",
      error: Object.assign(
        new Error(
          "Invocation of model ID anthropic.claude-opus-5 with on-demand throughput isn't supported.",
        ),
        {
          name: "ValidationException",
          $metadata: { httpStatusCode: 400 },
          $response: {
            statusCode: 400,
            body: { pipe: () => undefined, _events: { close: [null, null] } },
          },
        },
      ),
      expected: {
        status: 400,
        body: undefined,
        message: expect.stringContaining("on-demand throughput isn't supported"),
        messageCarriesBody: true,
      },
    },
    {
      name: "ignores a class-instance response body without a pipe method instead of serializing it",
      error: Object.assign(new Error("Input is too long for requested model."), {
        name: "ValidationException",
        $metadata: { httpStatusCode: 400 },
        $response: { statusCode: 400, body: new SdkHttpResponseBody() },
      }),
      expected: {
        status: 400,
        body: undefined,
        message: expect.stringContaining("Input is too long"),
        messageCarriesBody: true,
      },
    },
    {
      name: "ignores a class-instance `error` field instead of serializing it",
      error: Object.assign(new Error("TLS handshake failed"), {
        status: 502,
        error: new SdkInnerError(),
      }),
      expected: { body: undefined, message: "TLS handshake failed", messageCarriesBody: true },
    },
    {
      name: "treats an empty parsed body object as no body",
      error: Object.assign(new Error("403 status code (no body)"), { status: 403, error: {} }),
      expected: { body: undefined, messageCarriesBody: true },
    },
    {
      name: "truncates the body at the cap",
      error: Object.assign(new Error("failed"), {
        statusCode: 500,
        body: "x".repeat(MAX_PROVIDER_ERROR_BODY_CHARS + 50),
      }),
      expected: {
        body: `${"x".repeat(MAX_PROVIDER_ERROR_BODY_CHARS)}... [truncated 50 chars]`,
      },
    },
    {
      name: "sets messageCarriesBody when the message already contains the extracted body",
      error: Object.assign(new Error("500: upstream exploded"), {
        statusCode: 500,
        body: "upstream exploded",
      }),
      expected: { messageCarriesBody: true },
    },
  ])("$name", (input) => {
    expect(normalizeProviderError(input.error)).toMatchObject(input.expected);
  });
});

describe("formatProviderError", () => {
  const opaque = Object.assign(new Error("403 status code (no body)"), {
    status: 403,
    error: { error: "blocked by gateway WAF" },
  });
  const carried = JSON.stringify({ error: { message: "Permission denied" } });

  test.each([
    {
      name: "surfaces status and body from an opaque message",
      error: opaque,
      prefix: undefined,
      expected: '403: {"error":"blocked by gateway WAF"}',
    },
    {
      name: "surfaces status and body from an opaque message with a prefix",
      error: opaque,
      prefix: "OpenAI API error",
      expected: 'OpenAI API error (403): {"error":"blocked by gateway WAF"}',
    },
    {
      name: "preserves the message (with prefix + status) when it already carries the body",
      error: Object.assign(new Error(carried), { status: 403 }),
      prefix: "OpenAI API error",
      expected: `OpenAI API error (403): ${carried}`,
    },
    {
      name: "returns the bare message for a non-Error value",
      error: { reason: "boom" },
      prefix: undefined,
      expected: '{"reason":"boom"}',
    },
  ])("$name", (input) => {
    expect(formatProviderError(normalizeProviderError(input.error), input.prefix)).toBe(
      input.expected,
    );
  });
});
