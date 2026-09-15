import { Agent } from "@livekit/agents";
import type { CallOrchestrator } from "../orchestrator/CallOrchestrator.js";

/**
 * Preferred time, mock availability, appointment creation, and confirmation
 * (CLAUDE.md §7 `SchedulingAgent` — confirmation is this agent's job, not a
 * separate class, per the spec). Ends the call once a slot is booked (or the
 * caller declines a follow-up).
 */
export function createSchedulingAgent(orchestrator: CallOrchestrator): Agent {
  const instructions = orchestrator.contextService.buildInstructions({
    roleInstructions: `You manage salon appointments. Speak in natural Hinglish using Roman Hindi mixed with simple English. For a new booking, ask for the preferred day and time, call check_appointment_availability, offer only returned slots, and call schedule_follow_up only after the caller selects one. Do not say the appointment is booked before schedule_follow_up returns a successful appointmentId. For rescheduling or cancellation, first call get_appointment, read back the current appointment, and confirm the requested action. If get_appointment returns null, clearly say no active appointment was found and do not claim that one exists. For rescheduling, check availability and call reschedule_appointment only with a returned slot. For cancellation, call cancel_appointment only after explicit confirmation. Never claim an action succeeded unless the tool returns success.`,
    state: orchestrator.state,
    policyTopics: ["appointment", "communication"],
  });

  return Agent.create({
    instructions,
    tools: [
      orchestrator.tools.checkAppointmentAvailability(),
      orchestrator.tools.scheduleFollowUp(),
      orchestrator.tools.getAppointment(),
      orchestrator.tools.rescheduleAppointment(),
      orchestrator.tools.cancelAppointment(),
      orchestrator.tools.addCallNote(),
      orchestrator.tools.endCall(),
    ],
    // Same dead-air problem as IntakeAgent: without an opening line this agent would sit
    // silent after the handoff, waiting on a caller who is waiting on it.
    onEnter: async (ctx) => {
      ctx.session.generateReply({
        instructions:
          "Continue the existing booking conversation without greeting, introduction, or repeating the caller's request. " +
          "The booking intent is already known in context. Ask only for the next missing detail or use the correct appointment tool now.",
      });
    },
  });
}
