import {
  getRuntimeDefaultModel,
  listAvailableRuntimeModels,
  normalizeModel,
  resolveRuntimeModel,
} from '../domains/llm-gateway';

export const resolveWritableAgentModel = async (requestedModel?: string) => {
  const requested = normalizeModel(requestedModel || (await getRuntimeDefaultModel()));

  try {
    const { models } = await listAvailableRuntimeModels();
    const selected =
      models.find(
        model =>
          normalizeModel(model.id) === requested ||
          normalizeModel(model.apiModelId) === requested,
      ) || models[0];

    return selected?.apiModelId || requested;
  } catch {
    return resolveRuntimeModel(requested);
  }
};
