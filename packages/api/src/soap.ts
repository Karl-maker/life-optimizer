import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

/** Parses SOAP 1.1 or 1.2 envelopes after Fastify's XML body parser runs. */
export function parseSoapEnvelope(xml: string): unknown {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const envelope = parsed.Envelope;
  if (!envelope || typeof envelope !== "object")
    throw new SoapFaultError("Client", "A SOAP Envelope is required.");
  const body = (envelope as Record<string, unknown>).Body;
  if (!body || typeof body !== "object")
    throw new SoapFaultError("Client", "A SOAP Body is required.");
  return body;
}

export class SoapFaultError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly faultCode: "Client" | "Server",
    message: string,
  ) {
    super(message);
    this.name = "SoapFaultError";
  }
}

export function soapFaultXml(error: SoapFaultError, requestId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:${error.faultCode}</faultcode><faultstring>${escapeXml(error.message)}</faultstring><detail><requestId>${escapeXml(requestId)}</requestId></detail></soap:Fault></soap:Body></soap:Envelope>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
