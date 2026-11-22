import type { Json, JsonSchema, LanguageFeature } from "@nyte-ai/schema";
import { findProvider } from "./capabilities.ts";
import { LspError } from "./rpc.ts";
import type { Document, Servers, Target } from "./state.ts";

export interface Asked {
  readonly uri: string;
  readonly document: Document;
  readonly target: Target;
  readonly provider: JsonSchema;
}

export async function findProviders(
  servers: Servers,
  path: string,
  feature: LanguageFeature,
): Promise<readonly Asked[]> {
  const synced = await servers.sync(path);

  if (synced === null) return [];
  const uri = servers.uri(synced.document.path);

  return synced.targets.flatMap((target) => {
    const provider = findProvider(target.run, feature, synced.document);

    return provider === null ? [] : [{ uri, document: synced.document, target, provider }];
  });
}

export async function ask(
  servers: Servers,
  target: Target,
  method: string,
  params: Json,
): Promise<{ readonly answer: unknown } | LspError> {
  return target.run.rpc.request(method, params).then(
    (answer) => ({ answer }),
    (error: unknown) => {
      if (!(error instanceof LspError)) throw error;
      servers.record(target.slot, `${method} failed: ${error.message}`);

      return error;
    },
  );
}

export async function askEvery<T>(
  servers: Servers,
  input: { readonly path: string; readonly feature: LanguageFeature; readonly method: string },
  params: (asked: Asked) => Json,
  read: (answer: unknown, asked: Asked) => T,
): Promise<readonly T[]> {
  const answers = await Promise.all(
    (await findProviders(servers, input.path, input.feature)).map(async (asked) => {
      const asking = await ask(servers, asked.target, input.method, params(asked));

      return asking instanceof LspError ? [] : [read(asking.answer, asked)];
    }),
  );

  return answers.flat();
}

export async function askFirst<T>(
  servers: Servers,
  input: { readonly path: string; readonly feature: LanguageFeature; readonly method: string },
  params: (asked: Asked) => Json,
  read: (answer: unknown, asked: Asked) => T | null,
): Promise<T | null> {
  for (const asked of await findProviders(servers, input.path, input.feature)) {
    const asking = await ask(servers, asked.target, input.method, params(asked));
    const found = asking instanceof LspError ? null : read(asking.answer, asked);

    if (found !== null) return found;
  }

  return null;
}
