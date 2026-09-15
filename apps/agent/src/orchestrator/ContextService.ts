import type { PolicyTopic } from "../services/PolicyService.js";
import type { PolicyService } from "../services/PolicyService.js";
import type { CallState } from "./CallState.js";

const GLOBAL_RULES = `RULES
- Speak in natural Hinglish by default: use simple Hindi sentence structure written in Roman script, mixed naturally with common English words used in India. Do not respond in formal or fully Sanskritized Hindi.
- Keep dates, times, phone numbers, names, and important field values clear in English or their original form.
- Never invent facts the caller did not state.
- Never invent salon services, prices, durations, stylist names, availability, or appointment status.
- Never claim an appointment was booked, rescheduled, or cancelled unless the corresponding tool returned success.
- Confirm critical extracted information back to the caller before treating it as settled.
- Ask one question at a time. Keep turns short and conversational — this is a live voice call.
- Do not repeat the last assistant reply or ask the same question with cosmetic wording changes. Acknowledge new caller details and ask only for the next missing booking field.
- Minimize collection of sensitive information beyond what intake actually requires.
- If uncertain what the caller means, ask a clarifying question instead of guessing.`;

/**
 * Decides exactly what reaches the LLM (CLAUDE.md §14) — agent instructions,
 * phase, known caller/matter state, missing fields, and relevant policy.
 * Deliberately does NOT dump the whole database or full transcript; the
 * caller passes in only a bounded recent-turns excerpt when it wants one.
 */
export class ContextService {
  constructor(private readonly policyService: PolicyService) {}

  buildInstructions(params: {
    roleInstructions: string;
    state: CallState;
    policyTopics?: PolicyTopic[];
    recentTurnsExcerpt?: string;
  }): string {
    const { roleInstructions, state, policyTopics = [], recentTurnsExcerpt } = params;

    const sections: string[] = [
      roleInstructions.trim(),
      `CURRENT PHASE\n${state.currentPhase}`,
      `KNOWN CALLER\n${formatCaller(state)}`,
      `KNOWN MATTER FIELDS\n${formatFields(state)}`,
      `BOOKING INTENT\n${state.bookingIntent ?? "not yet determined"}`,
      `GREETING DELIVERED\n${state.greetingDelivered ? "yes; never greet again" : "no; triage may greet once"}`,
      `REQUIRED MISSING FIELDS\n${state.missingRequiredFields.join(", ") || "none"}`,
      `LAST ASSISTANT REPLY\n${state.lastAgentTurn ?? "none"}`,
      `RECENT VOICE TURNS\n${formatRecentTurns(state)}`,
    ];

    if (policyTopics.length > 0) {
      sections.push(`RELEVANT POLICY\n${this.policyService.getDocs(policyTopics)}`);
    }
    if (recentTurnsExcerpt) {
      sections.push(`RECENT CONVERSATION\n${recentTurnsExcerpt}`);
    }
    sections.push(GLOBAL_RULES);

    return sections.join("\n\n");
  }
}

function formatCaller(state: CallState): string {
  const { name, phone, email } = state.callerContact;
  if (!name && !phone && !email) return "unknown (not yet collected)";
  return [name && `name=${name}`, phone && `phone=${phone}`, email && `email=${email}`].filter(Boolean).join(", ");
}

function formatRecentTurns(state: CallState): string {
  const turns = state.recentUserTurns.map((text, index) => `caller: ${text}\nassistant: ${state.recentAgentTurns[index] ?? "(not recorded)"}`);
  return turns.length > 0 ? turns.slice(-3).join("\n") : "none";
}

function formatFields(state: CallState): string {
  const entries = Object.entries(state.collectedFields).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return "none collected yet";
  return entries.map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("; ") : v}`).join("\n");
}
