import { isIP } from "node:net";

interface ParsedAddress {
  version: 4 | 6;
  bits: number;
  value: bigint;
}

function parseIpv4(address: string): ParsedAddress | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  let value = 0n;
  for (const octet of octets) value = (value << 8n) | BigInt(octet!);
  return { version: 4, bits: 32, value };
}

function parseIpv6(address: string): ParsedAddress | null {
  if (isIP(address) !== 6) return null;
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const ipv4 = parseIpv4(normalized.slice(separator + 1));
    if (!ipv4) return null;
    const high = Number((ipv4.value >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4.value & 0xffffn).toString(16);
    normalized = `${normalized.slice(0, separator + 1)}${high}:${low}`;
  }
  const halves = normalized.split("::");
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right =
    halves.length < 2 || halves[1] === "" ? [] : halves[1]!.split(":");
  const omitted = 8 - left.length - right.length;
  const groups = [
    ...left,
    ...Array.from({ length: omitted }, () => "0"),
    ...right,
  ];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(`0x${group}`);
  return { version: 6, bits: 128, value };
}

function parseAddress(address: string): ParsedAddress | null {
  return parseIpv4(address) ?? parseIpv6(address);
}

export function isInCidr(address: string, cidr: string): boolean {
  const [networkText, prefixText, ...rest] = cidr.split("/");
  if (!networkText || !prefixText || rest.length > 0) return false;
  const addressValue = parseAddress(address);
  const network = parseAddress(networkText);
  const prefix = Number(prefixText);
  if (
    !addressValue ||
    !network ||
    addressValue.version !== network.version ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > network.bits
  )
    return false;
  const shift = BigInt(network.bits - prefix);
  return addressValue.value >> shift === network.value >> shift;
}
