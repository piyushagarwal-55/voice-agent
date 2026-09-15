import { tool, type FunctionTool } from "@livekit/agents";
import {
  CallEventType,
  addCallNoteInputSchema,
  checkAppointmentAvailabilityInputSchema,
  createCallerInputSchema,
  createMatterInputSchema,
  endCallInputSchema,
  getCallerInputSchema,
  getAppointmentInputSchema,
  rescheduleAppointmentInputSchema,
  cancelAppointmentInputSchema,
  getSalonServicesInputSchema,
  getMatterInputSchema,
  scheduleFollowUpInputSchema,
  updateMatterIntakeInputSchema,
} from "@repo/shared";
import type { AppointmentService } from "../services/AppointmentService.js";
import type { CallLogService } from "../services/CallLogService.js";
import type { CaseService } from "../services/CaseService.js";
import type { EventService } from "../services/EventService.js";
import type { SalonCatalogService } from "../services/SalonCatalogService.js";
import type { CallState } from "../orchestrator/CallState.js";

export interface ToolRegistryDeps {
  state: CallState;
  eventService: EventService;
  caseService: CaseService;
  appointmentService: AppointmentService;
  callLogService: CallLogService;
  salonCatalogService: SalonCatalogService;
  onEndCall: (reason: string, summary?: string | null) => Promise<void>;
}

const TOOL_DESCRIPTIONS = {
  get_salon_services: "Look up salon services, prices, durations, descriptions, and active stylist specialties. Use this for service or price questions; never invent a price.",
  get_appointment: "Retrieve the current active appointment for the caller. Use this before rescheduling or cancelling; never guess an appointment id or time.",
  reschedule_appointment: "Move the caller's existing appointment to a slot returned by availability. Only use after retrieving the active appointment and caller confirmation.",
  cancel_appointment: "Cancel the caller's existing appointment after confirming the appointment details and caller's request.",
  get_caller:
    "Look up an existing caller by phone number. Also returns their most recent open matter if they've called before — pass that matterId to get_matter to load what was already collected, instead of asking again.",
  create_caller: "Create a new caller record. Only call after you have the caller's name and phone number.",
  create_matter: "Create a new salon booking record once you know the requested service.",
  update_matter_intake: "Persist newly-learned structured intake fields onto the current matter. Call this whenever the caller gives new facts — do not wait until the end of the call.",
  get_matter: "Retrieve the current structured state of a matter, including anything already collected in a previous call.",
  check_appointment_availability: "Get mock available follow-up call slots near the caller's preferred time. Always call this before offering a specific time.",
  schedule_follow_up: "Book a salon appointment on a specific slot returned by check_appointment_availability. Do not tell the caller it is booked until this returns success.",
  add_call_note: "Record a free-text note on the call for a human reviewer (does not replace structured fields).",
  end_call: "End the call. Call this once you have said your goodbye to the caller.",
} as const;

/**
 * Central place tools are defined and exposed to agents (CLAUDE.md §7
 * `ToolRegistry`, §9). Every tool: validates input via the shared zod schema
 * (the LLM-visible JSON schema is derived from the same schema, so there's
 * no drift), logs tool.started/completed/failed through EventService, and
 * never lets a thrown error escape to the LLM as an exception — it comes
 * back as a `{ error }` result instead (CLAUDE.md §27 user-friendly fallback).
 */
export class ToolRegistry {
  constructor(private readonly deps: ToolRegistryDeps) {}

  getSalonServices() {
    return this.wrap("get_salon_services", getSalonServicesInputSchema, async (args: { query?: string }) =>
      this.deps.salonCatalogService.search(args.query),
    );
  }

  getAppointment() {
    return this.wrap("get_appointment", getAppointmentInputSchema, async () => {
      if (!this.deps.state.matterId) return { appointment: null };
      const appointment = await this.deps.appointmentService.getCurrentForMatter(this.deps.state.matterId);
      return { appointment: appointment ? { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt.toISOString(), type: appointment.type, status: appointment.status } : null };
    });
  }

  rescheduleAppointment() {
    return this.wrap("reschedule_appointment", rescheduleAppointmentInputSchema, async (args: { appointmentId: string; slotId: string; appointmentRequestId: string }) => {
      await this.assertCurrentAppointment(args.appointmentId);
      return this.deps.appointmentService.reschedule(args);
    });
  }

  cancelAppointment() {
    return this.wrap("cancel_appointment", cancelAppointmentInputSchema, async (args: { appointmentId: string; cancellationRequestId: string }) => {
      await this.assertCurrentAppointment(args.appointmentId);
      return this.deps.appointmentService.cancel(args);
    });
  }

  private async assertCurrentAppointment(appointmentId: string): Promise<void> {
    if (!this.deps.state.matterId) throw new Error("no caller booking is loaded");
    const appointment = await this.deps.appointmentService.getCurrentForMatter(this.deps.state.matterId);
    if (!appointment || appointment.id !== appointmentId) throw new Error("appointment does not belong to the current caller");
  }

  // `any` here (not `unknown`) is deliberate: LiveKit's `FunctionTool` constrains its
  // parameters type to `JSONObject`, which our zod input schemas satisfy at runtime but
  // TS can't verify generically through this bridge — the zod schema is still the real
  // validation boundary.
  private wrap<Args extends Record<string, any>, Result>(
    name: keyof typeof TOOL_DESCRIPTIONS,
    parameters: Parameters<typeof tool>[0]["parameters"],
    handler: (args: Args) => Promise<Result>,
  ): FunctionTool<Args, unknown, Result | { error: string }> {
    const { state, eventService } = this.deps;
    return tool({
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters,
      execute: async (args) => {
        const start = Date.now();
        await eventService.emit(CallEventType.TOOL_STARTED, {
          agent: state.activeAgent,
          phase: state.currentPhase,
          metadata: { tool: name, input: args },
        });
        try {
          const result = await handler(args as Args);
          await eventService.emit(CallEventType.TOOL_COMPLETED, {
            agent: state.activeAgent,
            phase: state.currentPhase,
            durationMs: Date.now() - start,
            metadata: { tool: name, output: result as Record<string, unknown> },
          });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await eventService.emit(CallEventType.TOOL_FAILED, {
            agent: state.activeAgent,
            phase: state.currentPhase,
            durationMs: Date.now() - start,
            metadata: { tool: name, error: message },
          });
          return { error: message };
        }
      },
    }) as FunctionTool<Args, unknown, Result | { error: string }>;
  }

  getCaller() {
    return this.wrap("get_caller", getCallerInputSchema, async (args: { phone: string }) => {
      const caller = await this.deps.caseService.findCallerByPhone(args.phone.trim());
      if (!caller) return { found: false, callerId: null, name: null, email: null, existingMatter: null };
      this.deps.state.callerId = caller.id;
      this.deps.state.callerContact = { name: caller.name, phone: caller.phone, email: caller.email };

      // Structured retrieval (CLAUDE.md §13): a returning caller resumes their open matter
      // rather than starting a second one. Adopting the id here is what makes the existing
      // case reachable at all — get_matter can then load its fields into live call state.
      const existing = caller.matters[0];
      if (existing) {
        this.deps.state.matterId = existing.id;
        await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, {
          callerId: caller.id,
          matterId: existing.id,
        });
      } else {
        await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, { callerId: caller.id });
      }

      return {
        found: true,
        callerId: caller.id,
        name: caller.name,
        email: caller.email,
        existingMatter: existing
          ? { matterId: existing.id, serviceRequested: existing.incidentType, status: existing.status }
          : null,
      };
    });
  }

  createCaller() {
    return this.wrap("create_caller", createCallerInputSchema, async (args: { name: string; phone: string; email?: string | null }) => {
      const caller = await this.deps.caseService.createCaller(args);
      this.deps.state.callerId = caller.id;
      this.deps.state.callerContact = { name: caller.name, phone: caller.phone, email: caller.email };
      await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, { callerId: caller.id });
      return { callerId: caller.id };
    });
  }

  createMatter() {
    return this.wrap("create_matter", createMatterInputSchema, async (args: { callerId: string; serviceRequested: string }) => {
      const matter = await this.deps.caseService.createMatter({ callerId: args.callerId, matterType: args.serviceRequested });
      this.deps.state.matterId = matter.id;
      this.deps.state.mergeIntakeFields({ serviceRequested: matter.incidentType });
      await this.deps.callLogService.attachCallerAndMatter(this.deps.state.callId, { matterId: matter.id });
      // Flush anything already gathered in-memory before the matter existed (e.g. extracted
      // during triage) so it isn't silently lost now that there's somewhere to persist it.
      if (Object.keys(this.deps.state.collectedFields).length > 0) {
        await this.deps.caseService.updateIntake(matter.id, this.deps.state.collectedFields);
      }
      return { matterId: matter.id };
    });
  }

  updateMatterIntake() {
    return this.wrap(
      "update_matter_intake",
      updateMatterIntakeInputSchema,
      async (args: { matterId: string; fields: Record<string, unknown> }) => {
        const updatedFields = this.deps.state.mergeIntakeFields(args.fields as never);
        await this.deps.caseService.updateIntake(args.matterId, args.fields as never);
        return { matterId: args.matterId, updatedFields, missingRequiredFields: this.deps.state.missingRequiredFields };
      },
    );
  }

  getMatter() {
    return this.wrap("get_matter", getMatterInputSchema, async (args: { matterId: string }) => {
      const matter = await this.deps.caseService.getMatter(args.matterId);
      if (!matter) return { matterId: null, found: false, status: null, qualificationStatus: null, fields: null };
      // Retrieval within the same call (CLAUDE.md demo item 6): sync into live state.
      this.deps.state.mergeIntakeFields({
        serviceRequested: matter.incidentType,
        preferredDate: matter.incidentDate?.toISOString().slice(0, 10) ?? null,
        bookingNotes: matter.incidentDescription,
        stylistPreference: matter.otherPartyInformation,
      });
      return {
        matterId: matter.id,
        found: true,
        status: matter.status,
        qualificationStatus: matter.qualificationStatus,
        fields: this.deps.state.collectedFields,
      };
    });
  }

  checkAppointmentAvailability() {
    return this.wrap(
      "check_appointment_availability",
      checkAppointmentAvailabilityInputSchema,
      async (args: { preferredWindowStart: string }) => ({
        slots: this.deps.appointmentService.checkAvailability(args.preferredWindowStart),
      }),
    );
  }

  scheduleFollowUp() {
    return this.wrap(
      "schedule_follow_up",
      scheduleFollowUpInputSchema,
      async (args: { matterId: string; slotId: string; appointmentRequestId: string }) => {
        if (!this.deps.state.matterId || args.matterId !== this.deps.state.matterId) {
          throw new Error("booking does not belong to the current caller");
        }
        return this.deps.appointmentService.scheduleFollowUp({ ...args, callId: this.deps.state.callId });
      },
    );
  }

  addCallNote() {
    return this.wrap("add_call_note", addCallNoteInputSchema, async (args: { callId: string; note: string }) => {
      if (this.deps.state.matterId) {
        await this.deps.caseService.appendNote(this.deps.state.matterId, args.note);
      }
      await this.deps.eventService.emit(CallEventType.CALL_NOTE, {
        agent: this.deps.state.activeAgent,
        phase: this.deps.state.currentPhase,
        metadata: { note: args.note },
      });
      return { saved: true };
    });
  }

  endCall() {
    return this.wrap("end_call", endCallInputSchema, async (args: { reason: string; summary?: string | null }) => {
      await this.deps.onEndCall(args.reason, args.summary ?? null);
      return { ended: true, reason: args.reason };
    });
  }
}
