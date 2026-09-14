import { Agent, handoff, tool } from "@livekit/agents";
import { z } from "zod";
import { AgentName, CallPhase } from "@repo/shared";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";

/**
 * Receptionist/triage (CLAUDE.md §8 entry point). Greets the caller,
 * explains it's an automated intake assistant, and routes either into
 * IntakeAgent (potential case) or straight to answer/end (general question)
 * or a human handoff (out of scope / caller asks for a person).
 */
export function createTriageAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You are the receptionist assistant for a salon. Speak in warm, natural Hinglish using Roman Hindi mixed with simple English, for example: "Namaste, main salon ka automated booking assistant hoon. Aapko kis service ke liye appointment chahiye?"
Greet the caller and understand whether they want information, a new booking, a reschedule, or a cancellation.
- If they ask about a service, price, duration, or stylist, call get_salon_services before answering. Never invent catalog data.
- If they want to book, reschedule, or cancel, call begin_intake immediately. Do not collect booking details yourself.
- If they ask about hours or salon policies, answer from policy, then ask if they need a booking.
- If they explicitly ask for a human, call request_human_handoff.
- You decide when the conversation is over: once the caller says goodbye, says they have nothing further, or clearly
  wants to stop, say a brief closing line and then call end_call. Do not leave the call hanging open.`,
    state: orchestrator.state,
    policyTopics: ["communication", "escalation"],
  });

  return Agent.create({
    instructions,
    tools: [
      tool({
        name: "begin_intake",
        description: "Hand off to the booking assistant once the caller wants to book, reschedule, or cancel an appointment.",
        parameters: z.object({}),
        execute: async () => {
          const callerRequest = orchestrator.state.lastUserTurn?.toLowerCase() ?? "";
          orchestrator.state.bookingIntent = callerRequest.includes("cancel") || callerRequest.includes("cancell")
            ? "cancel"
            : callerRequest.includes("resched") || callerRequest.includes("shift") || callerRequest.includes("change")
              ? "reschedule"
              : "new";
          const result = orchestrator.prepareHandoff(AgentName.INTAKE);
          if (!result) return "I'm not able to move to intake right now.";
          const action = orchestrator.state.bookingIntent === "cancel"
            ? "The caller wants to cancel an existing appointment. Do not ask for a service. Ask for the phone number and retrieve the existing appointment."
            : orchestrator.state.bookingIntent === "reschedule"
              ? "The caller wants to reschedule an existing appointment. Do not ask for a new service unless necessary. Ask for the phone number and retrieve the existing appointment."
              : "The caller wants a new salon booking. Ask which service they want.";
          return handoff({ agent: result.agent, returns: action });
        },
      }),
      orchestrator.tools.getSalonServices(),
      tool({
        name: "request_human_handoff",
        description: "Escalate to a human instead of continuing automated intake (caller asked for a human, emergency, abuse, or clearly out of scope).",
        parameters: z.object({ reason: z.string() }),
        execute: async ({ reason }) => {
          orchestrator.transitionPhase(CallPhase.HANDOFF_HUMAN, reason);
          await orchestrator.endCall("handoff_human", reason);
          return { handedOff: true };
        },
      }),
      orchestrator.tools.endCall(),
    ],
    onEnter: async (ctx) => {
      ctx.session.generateReply({
        instructions:
          "Greet the caller in natural Hinglish using Roman Hindi and simple English, identify yourself as the salon's automated booking assistant, and ask which service they need today.",
      });
    },
  });
}
