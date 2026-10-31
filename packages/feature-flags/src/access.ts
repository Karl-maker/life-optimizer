import type { FlagDecision } from "./types.js";

export type FlagAccessPolicy =
  | { kind: "flag"; flagKey: string; variants: readonly string[] }
  | { kind: "all"; policies: readonly FlagAccessPolicy[] }
  | { kind: "any"; policies: readonly FlagAccessPolicy[] }
  | { kind: "not"; policy: FlagAccessPolicy };

/** Missing decisions fail closed, which makes this suitable for API data filtering. */
export function hasFlagAccess(
  policy: FlagAccessPolicy,
  decisions: ReadonlyMap<string, FlagDecision>,
): boolean {
  return evaluateAccess(policy, decisions) === true;
}

function evaluateAccess(
  policy: FlagAccessPolicy,
  decisions: ReadonlyMap<string, FlagDecision>,
): boolean | undefined {
  switch (policy.kind) {
    case "flag": {
      const decision = decisions.get(policy.flagKey);
      if (decision === undefined) return undefined;
      return policy.variants.includes(decision.variant);
    }
    case "all": {
      let missing = false;
      for (const candidate of policy.policies) {
        const value = evaluateAccess(candidate, decisions);
        if (value === false) return false;
        if (value === undefined) missing = true;
      }
      return missing ? undefined : true;
    }
    case "any": {
      let missing = false;
      for (const candidate of policy.policies) {
        const value = evaluateAccess(candidate, decisions);
        if (value === true) return true;
        if (value === undefined) missing = true;
      }
      return missing ? undefined : false;
    }
    case "not": {
      const value = evaluateAccess(policy.policy, decisions);
      return value === undefined ? undefined : !value;
    }
  }
}

/** Keeps domain records unaware of flags by accepting an adapter-owned policy selector. */
export function filterByFlagAccess<T>(
  values: readonly T[],
  decisions: ReadonlyMap<string, FlagDecision>,
  policyFor: (value: T) => FlagAccessPolicy | null,
): T[] {
  return values.filter((value) => {
    const policy = policyFor(value);
    return policy === null || hasFlagAccess(policy, decisions);
  });
}
