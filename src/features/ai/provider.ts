import { command } from "../../services/platform";
export type ModelRole = "fast" | "balanced" | "advanced";
export interface AIRequest {
  requestId: string;
  model: string;
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
}
export interface AIProvider {
  generate(request: AIRequest): Promise<{ text: string; model: string }>;
  cancel(id: string): Promise<unknown>;
}
export const openAIProvider: AIProvider = {
  generate: (request) => command("ai_generate", { ...request }),
  cancel: (requestId) => command("ai_cancel", { requestId }),
};
export function modelFor(settings: Record<string, string>, role: ModelRole) {
  const model =
    settings[`ai_${role}_model`] ?? (role === "advanced" ? "" : "gpt-5-mini");
  if (!model || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model))
    throw Error(`Configure the ${role} model in Settings → AI.`);
  return model;
}
