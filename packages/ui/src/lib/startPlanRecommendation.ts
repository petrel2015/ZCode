import { type ModelSelection } from "@zcode/shared";

/** 只改思考档位、继承或其他字段不属于模型更换。 */
export function hasExplicitModelChanged(
  previous: ModelSelection | null | undefined,
  next: ModelSelection | null | undefined,
): next is ModelSelection {
  return Boolean(
    next && (previous?.providerId !== next.providerId || previous.modelId !== next.modelId),
  );
}
