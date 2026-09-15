import { Agent, handoff, tool } from "@livekit/agents";
import { z } from "zod";
import { AgentName } from "@repo/shared";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";

/**
 * Conversational field collection (CLAUDE.md §7 `IntakeAgent`). Never
 * invents missing information, asks one useful question at a time, and
 * confirms critical facts. After every user turn it runs structured
 * extraction (OpenRouterService) and persists whatever new fields were
 * actually stated — the LLM's free-form reply text never itself becomes
 * the source of truth (CLAUDE.md §15).
 */
export function createIntakeAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You are the salon booking specialist. Speak in natural Hinglish using Roman Hindi mixed with simple English. The BOOKING INTENT in the context is authoritative. If it is cancel or reschedule, never switch to new booking and never ask which service they want. Ask for the caller's complete registered phone number, and if they provide only a fragment such as "8 9", politely ask them to repeat the full number. Then call get_caller and get_appointment. For cancellation, read back the appointment and ask for explicit confirmation before calling cancel_appointment. For rescheduling, ask for a new preferred time, check availability, and call reschedule_appointment only with a returned slot after confirmation. Only if the intent is new should you ask for service, preferred stylist, date, time, name, and phone. Use get_salon_services for catalog facts. Never invent a service, price, stylist, availability, appointment, or successful action. If the caller wants to stop, close politely and call end_call.`,
    state: orchestrator.state,
    policyTopics: ["intake", "communication"],
  });

  return Agent.create({
    instructions,
    tools: [
      orchestrator.tools.getSalonServices(),
      orchestrator.tools.getCaller(),
      orchestrator.tools.createCaller(),
      orchestrator.tools.createMatter(),
      orchestrator.tools.checkAppointmentAvailability(),
      orchestrator.tools.getAppointment(),
      orchestrator.tools.rescheduleAppointment(),
      orchestrator.tools.cancelAppointment(),
      orchestrator.tools.addCallNote(),
      tool({
        name: "proceed_to_qualification",
        description: "Move to booking review once enough booking details have been gathered (or the caller has no more to share).",
        parameters: z.object({}),
        execute: async () => {
          const result = orchestrator.prepareHandoff(AgentName.QUALIFICATION);
          if (!result) return "Not ready to move to qualification yet.";
          return handoff({ agent: result.agent, returns: "Let's go over qualification next." });
        },
      }),
      orchestrator.tools.endCall(),
    ],
    // Structured extraction is not wired here: it runs for every user turn in every
    // phase, from CallOrchestrator.recordUserTurn (callers share booking details during
    // TRIAGE, long before this agent takes over).
    onEnter: async (ctx) => {
      // Without this the handoff lands in dead air: triage says "connecting you now",
      // this agent takes over and then waits for the caller to speak first, so the call
      // silently stalls forever. Speak immediately on entry instead.
      const missing = orchestrator.state.missingRequiredFields;
      const entryInstruction = orchestrator.state.bookingIntent === "cancel"
        ? "The caller wants to cancel an existing appointment. Ask only for their complete registered phone number in Roman Hinglish. Do not ask for a service, date, or new booking details."
        : orchestrator.state.bookingIntent === "reschedule"
          ? "The caller wants to reschedule an existing appointment. Ask only for their complete registered phone number in Roman Hinglish. Do not ask for a service or new booking details yet."
          : "The caller wants a new salon booking. Ask only for the next missing booking detail in Roman Hinglish.";
      ctx.session.generateReply({
        instructions:
          "Continue the existing conversation without any greeting, introduction, prayer, or repeated welcome. Do not " +
          "introduce yourself as a new person, and never tell them to hold or wait — you are the " +
          "one collecting these details, right now. " + entryInstruction + " If the caller gives only a partial " +
          "number, ask them to repeat the full number and do not start a new booking." +
          (missing.length > 0 ? ` Still missing: ${missing.join(", ")}. Ask for exactly one, preferably the first missing field.` : " Confirm the booking details you have so far."),
      });
    },
  });
}
