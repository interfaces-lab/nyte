import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { dev } from "@nyte-ai/core";
import type { SettingDefinition } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "./core.ts";

const endpoint: SettingDefinition<string> = {
  id: "telemetry.endpoint",
  label: "OTLP traces endpoint",
  schema: standard(Type.String()),
  default: "",
  scope: "host",
};

/** One endpoint's provider and the sessions holding it. */
interface Held {
  readonly provider: TracerProvider;
  readonly tracer: Tracer;
  holders: number;
}

/** The tracer providers by endpoint (§48h): one per endpoint on this host, shut down when the last session holding it lets go. */
const providers = new Map<string, Held>();

/** Holds the provider for `url`, creating it on first use, and returns its tracer and the release. */
function hold(url: string): { readonly tracer: Tracer; release(): void } {
  const known = providers.get(url);

  const held: Held = known ?? {
    ...traced(
      new TracerProvider({
        resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "nyte" }),
        spanProcessors: [new SimpleSpanProcessor({ exporter: new OTLPTraceExporter({ url }) })],
      }),
    ),
    holders: 0,
  };

  held.holders += 1;
  providers.set(url, held);
  let released = false;

  return {
    tracer: held.tracer,
    release() {
      if (released) return;
      released = true;
      held.holders -= 1;

      if (held.holders > 0) return;
      providers.delete(url);
      void held.provider.shutdown();
    },
  };
}

/** Returns a provider with its tracer. */
function traced(provider: TracerProvider): {
  readonly provider: TracerProvider;
  readonly tracer: Tracer;
} {
  return { provider, tracer: provider.getTracer("@nyte-ai/plugin/telemetry") };
}

/**
 * Exports one span per model request to an OTLP/HTTP traces endpoint, the
 * host setting `telemetry.endpoint`; empty, the default, exports nothing.
 * The span runs from the request's start to its settlement and carries the
 * model, step, thinking level, session, run and token usage. Each session
 * follows the setting as it changes, and sessions on one endpoint share one
 * tracer provider (§48h).
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "telemetry",
  contribute: { settings: [endpoint] },
  activate(api) {
    let current: ReturnType<typeof hold> | null = null;

    api.hook("after_request", (event, { session, run }) => {
      const end = Date.now();

      current?.tracer
        .startSpan(`${event.step} ${event.model.provider}/${event.model.id}`, {
          startTime: end - event.durationMs,
          attributes: {
            "gen_ai.provider.name": event.model.provider,
            "gen_ai.request.model": event.model.id,
            "gen_ai.usage.input_tokens": event.usage.input,
            "gen_ai.usage.output_tokens": event.usage.output,
            "nyte.step": event.step,
            "nyte.thinking": event.thinking,
            "nyte.session": session ?? "",
            "nyte.run": run ?? "",
            "nyte.cost": event.usage.cost.total,
          },
        })
        .end(end);
    });

    void (async () => {
      for await (const url of api.contribute.settings.watch(endpoint.id)) {
        current?.release();
        current = typeof url === "string" && url !== "" ? hold(url) : null;
        dev("telemetry", "endpoint", {
          session: api.session.id,
          exporting: current !== null,
          providers: providers.size,
        });
      }

      current?.release();
      current = null;
    })();
  },
} satisfies Plugin;
