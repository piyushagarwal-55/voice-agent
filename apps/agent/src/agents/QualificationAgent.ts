import { Agent, handoff, tool } from "@livekit/agents";
import { z } from "zod";
import { AgentName, QualificationStatus } from "@repo/shared";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";

/**
 * Explains the outcome of the deterministic qualification check (CLAUDE.md
 * §7/§9/§34) — the LLM never decides qualification itself, it only phrases
 * the result and routes to the right next step. `runQualification()` (pure
 * rule evaluation) already ran and persisted before the caller hears anything.
 */
export function createQualificationAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You are the salon booking review assistant. Speak in natural Hinglish using Roman Hindi mixed with simple English. Review whether the caller has selected a service and provided enough contact information to continue booking. If ready, briefly confirm the selected service and call proceed_to_scheduling. If information is missing, call return_to_intake. Do not invent prices, stylists, or availability.`,
    state: orchestrator.state,
    policyTopics: ["communication"],
  });

  return Agent.create({
    instructions,
    tools: [
      tool({
        name: "proceed_to_scheduling",
        description: "Move to salon appointment scheduling after booking details are ready.",
        parameters: z.object({}),
        execute: async () => {
          const result = orchestrator.prepareHandoff(AgentName.SCHEDULING);
          if (!result) return "Not ready to move to scheduling yet.";
          return handoff({ agent: result.agent, returns: "Let's get a follow-up scheduled." });
        },
      }),
      tool({
        name: "return_to_intake",
        description: "Return to the salon booking assistant to gather missing booking information.",
        parameters: z.object({}),
        execute: async () => {
          const result = orchestrator.prepareHandoff(AgentName.INTAKE);
          if (!result) return "Not able to return to intake right now.";
          return handoff({ agent: result.agent, returns: "Let's go over a few more details." });
        },
      }),
      orchestrator.tools.endCall(),
    ],
    onEnter: async (ctx) => {
      const result = await orchestrator.runQualification();
      const reasonText = result.reasons.length > 0 ? ` (${result.reasons.join(", ")})` : "";
      ctx.session.generateReply({
        instructions:
          `Booking readiness result: ${result.status}${reasonText}. Do not recap the greeting or repeat collected details. Explain this briefly per your ` +
          (result.status === QualificationStatus.QUALIFIED
            ? "QUALIFIED instructions, then call proceed_to_scheduling."
            : result.status === QualificationStatus.DISQUALIFIED
              ? "DISQUALIFIED instructions, then call end_call."
              : "INSUFFICIENT instructions, then call return_to_intake."),
      });
    },
  });
}
