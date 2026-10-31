import { isIP } from "node:net";
import type { Condition, FlagDefinition } from "./types.js";

const KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ATTRIBUTE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

function assertKey(value: string, label: string): void {
  if (!KEY.test(value))
    throw new Error(`${label} must be a stable lowercase key.`);
}

function assertAttribute(value: string): void {
  if (!ATTRIBUTE.test(value))
    throw new Error("Attribute name must be a stable key.");
}

function assertCondition(condition: Condition, depth = 0): void {
  if (depth > 8) throw new Error("Condition nesting cannot exceed 8 levels.");
  if (condition.kind === "all" || condition.kind === "any") {
    if (condition.conditions.length < 1 || condition.conditions.length > 20)
      throw new Error(`${condition.kind} must contain 1 to 20 conditions.`);
    for (const child of condition.conditions) assertCondition(child, depth + 1);
    return;
  }
  if (condition.kind === "not") {
    assertCondition(condition.condition, depth + 1);
    return;
  }
  if (condition.kind === "custom") {
    assertKey(condition.name, "Custom condition name");
    return;
  }
  assertAttribute(condition.attribute);
  if (condition.operator === "one_of" || condition.operator === "not_one_of") {
    if (condition.values.length < 1 || condition.values.length > 100)
      throw new Error(`${condition.operator} must contain 1 to 100 values.`);
  }
  if (condition.operator === "email_domain") {
    if (condition.domains.length < 1 || condition.domains.length > 100)
      throw new Error("email_domain must contain 1 to 100 domains.");
    for (const domain of condition.domains) {
      if (
        domain.length > 253 ||
        domain !== domain.toLowerCase() ||
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)
      )
        throw new Error(
          "Email domains must be normalized lowercase hostnames.",
        );
    }
  }
  if (condition.operator === "cidr") {
    if (condition.blocks.length < 1 || condition.blocks.length > 100)
      throw new Error("cidr must contain 1 to 100 blocks.");
    for (const block of condition.blocks) {
      const [address, prefix, ...rest] = block.split("/");
      const bits = address
        ? isIP(address) === 4
          ? 32
          : isIP(address) === 6
            ? 128
            : 0
        : 0;
      if (
        rest.length > 0 ||
        bits === 0 ||
        !/^\d{1,3}$/.test(prefix ?? "") ||
        Number(prefix) > bits
      )
        throw new Error(`Invalid CIDR block: ${block}.`);
    }
  }
}

/** Validates a versioned definition at startup, before any user can be evaluated. */
export function defineFlag<const T extends FlagDefinition>(definition: T): T {
  if (definition.schemaVersion !== 1)
    throw new Error("Unsupported flag schema version.");
  assertKey(definition.key, "Flag key");
  if (definition.version.length < 1 || definition.version.length > 128)
    throw new Error("Flag version must contain 1 to 128 characters.");
  if (definition.variants.length < 1 || definition.variants.length > 100)
    throw new Error("A flag must define 1 to 100 variants.");
  const variants = new Set<string>();
  for (const variant of definition.variants) {
    assertKey(variant.key, "Variant key");
    if (variants.has(variant.key))
      throw new Error(`Duplicate variant: ${variant.key}.`);
    variants.add(variant.key);
  }
  for (const key of [definition.offVariant, definition.defaultVariant]) {
    if (!variants.has(key)) throw new Error(`Unknown variant: ${key}.`);
  }
  if (definition.rules.length > 100)
    throw new Error("A flag cannot exceed 100 rules.");
  const ruleIds = new Set<string>();
  for (const rule of definition.rules) {
    assertKey(rule.id, "Rule ID");
    if (ruleIds.has(rule.id)) throw new Error(`Duplicate rule ID: ${rule.id}.`);
    ruleIds.add(rule.id);
    assertCondition(rule.when);
    if (rule.serve.kind === "variant") {
      if (!variants.has(rule.serve.variant))
        throw new Error(`Rule ${rule.id} references an unknown variant.`);
    } else {
      if (rule.serve.salt.length < 1 || rule.serve.salt.length > 128)
        throw new Error(`Rule ${rule.id} needs a bounded rollout salt.`);
      if (
        rule.serve.allocations.length < 1 ||
        rule.serve.allocations.length > 100
      )
        throw new Error(`Rule ${rule.id} needs 1 to 100 allocations.`);
      let total = 0;
      const allocated = new Set<string>();
      for (const allocation of rule.serve.allocations) {
        if (
          !variants.has(allocation.variant) ||
          allocated.has(allocation.variant)
        )
          throw new Error(`Rule ${rule.id} has an invalid variant allocation.`);
        if (
          !Number.isInteger(allocation.basisPoints) ||
          allocation.basisPoints < 1
        )
          throw new Error(
            "Rollout allocations must use positive integer basis points.",
          );
        allocated.add(allocation.variant);
        total += allocation.basisPoints;
      }
      if (total > 10_000)
        throw new Error(
          "Rollout allocations cannot exceed 10,000 basis points.",
        );
    }
  }
  return definition;
}
