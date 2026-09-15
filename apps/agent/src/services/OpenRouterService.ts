import { z } from "zod";
import { createLogger, intakeFieldsSchema, type IntakeFields } from "@repo/shared";
import { env } from "../env.js";

const logger = createLogger("agent:groq");

const intakeJsonSchema = toStrictJsonSchema(z.toJSONSchema(intakeFieldsSchema) as JsonSchemaObject);

type JsonSchemaObject = Record<string, unknown>;


function toStrictJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
  if (schema.type !== "object" || typeof schema.properties !== "object" || schema.properties === null) {
    return schema;
  }
  const properties = schema.properties as Record<string, JsonSchemaObject>;
  const strictProperties: Record<string, JsonSchemaObject> = {};
  for (const [key, value] of Object.entries(properties)) {
    strictProperties[key] = toStrictJsonSchema(value);
  }
  return {
    ...schema,
    properties: strictProperties,
    required: Object.keys(strictProperties),
    additionalProperties: false,
  };
}

export interface ExtractIntakeInput {
  /** Recent conversation, rendered as plain "role: text" lines. */
  conversationExcerpt: string;
  alreadyKnown: IntakeFields;
}

export interface ExtractIntakeResult {
  fields: IntakeFields;
  durationMs: number;
}


export class OpenRouterService {
  async extractIntakeFields(input: ExtractIntakeInput): Promise<ExtractIntakeResult> {
    const start = Date.now();
    let text = "";
    try {
      const result = await chatCompletion({
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You extract structured salon booking facts for a voice receptionist. " +
              "Report ONLY facts the caller explicitly stated in the conversation excerpt. " +
              "Never invent, assume, or infer a value that was not said. " +
              "Omit (leave null) any field that is still unknown. " +
              "Preserve previously-known field values unless the caller corrected them.",
          },
          {
            role: "user",
            content: `Already known fields:\n${JSON.stringify(input.alreadyKnown)}\n\nConversation excerpt:\n${input.conversationExcerpt}`,
          },
        ],
        response_format: { type: "json_schema", json_schema: { name: "intake_fields", strict: true, schema: intakeJsonSchema } },
      });
      text = result.choices[0]?.message?.content ?? "";
    } catch (err) {
      throw new Error(`extraction request failed: ${describeError(err)}`);
    }

    const durationMs = Date.now() - start;
    if (!text.trim()) throw new Error("extraction returned an empty response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`extraction returned invalid JSON: ${describeError(err)}`);
    }

    const validated = intakeFieldsSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`extraction failed schema validation: ${validated.error.issues.length} issue(s)`);
    }
    return { fields: validated.data, durationMs };
  }

  /** Short human-readable booking summary for the call-ended confirmation + Call.finalSummary. */
  async summarizeCall(input: { transcriptExcerpt: string; fields: IntakeFields }): Promise<string> {
    try {
      const result = await chatCompletion({
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Write a concise (2-4 sentence) internal salon booking summary. " +
              "Include the requested service, preferred time, caller details, and booking outcome only.",
          },
          {
            role: "user",
            content: `Known fields:\n${JSON.stringify(input.fields)}\n\nTranscript excerpt:\n${input.transcriptExcerpt}`,
          },
        ],
      });
      return result.choices[0]?.message?.content?.trim() ?? "";
    } catch (err) {
      logger.error("summarize.request_failed", { message: String(err) });
      return "";
    }
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

async function chatCompletion(input: {
  messages: ChatMessage[];
  temperature: number;
  response_format?: { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: JsonSchemaObject } };
}): Promise<Required<ChatCompletionResponse>> {
  const response = await fetch(`${env.GROQ_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: env.GROQ_LLM_MODEL, ...input }),
  });
  if (!response.ok) throw new Error(`Groq returned HTTP ${response.status}: ${await response.text()}`);
  const result = (await response.json()) as ChatCompletionResponse;
  if (!result.choices) throw new Error("Groq returned no choices");
  return result as Required<ChatCompletionResponse>;
}

/** SDK errors stringify to a bare class name ("Provider returned error"); the actionable
 * detail lives in a nested body/metadata field, so surface that too when present. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const detail = (err as Error & { body?: unknown; responseBody?: unknown }).body ?? (err as Error & { responseBody?: unknown }).responseBody;
  return detail ? `${err.message} — ${JSON.stringify(detail).slice(0, 400)}` : err.message;
}

