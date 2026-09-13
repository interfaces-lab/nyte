import { createServerModels } from "./chat.ts";

export function serverModels() {
  const models = createServerModels(process.env);
  const configured = process.env.NYTE_MODEL ?? "openai-codex/gpt-5.6-sol";
  const slash = configured.indexOf("/");
  const model =
    slash === -1
      ? undefined
      : models.getModel(configured.slice(0, slash), configured.slice(slash + 1));
  if (!model) throw new Error("NYTE_MODEL must name a known provider/model.");
  return { model, models };
}
