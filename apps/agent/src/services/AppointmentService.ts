import { prisma } from "@repo/db";

/**
 * Mock calendar availability + appointment creation (CLAUDE.md §7
 * `AppointmentService`, §9). No real calendar integration — availability is
 * deterministically generated so the demo is reproducible, and slot ids
 * encode the datetime directly so `scheduleFollowUp` needs no separate
 * "held slot" storage.
 */
export class AppointmentService {
  async getCurrentForMatter(matterId: string) {
    return prisma.appointment.findFirst({ where: { matterId, status: { in: ["SCHEDULED", "CONFIRMED"] } }, orderBy: { scheduledAt: "asc" } });
  }

  /** Three business-hour slots starting the next business day after the caller's preferred window. */
  checkAvailability(preferredWindowStart: string): { slotId: string; startsAt: string }[] {
    const base = new Date(preferredWindowStart);
    const start = Number.isNaN(base.getTime()) ? new Date() : base;

    const slots: { slotId: string; startsAt: string }[] = [];
    let daysAdded = 0;
    let cursor = new Date(start);
    while (slots.length < 3) {
      cursor = addDays(cursor, 1);
      if (isWeekend(cursor)) continue;
      daysAdded += 1;
      for (const hour of [10, 14]) {
        if (slots.length >= 3) break;
        const slotTime = new Date(cursor);
        slotTime.setHours(hour, 0, 0, 0);
        slots.push({ slotId: `slot-${slotTime.toISOString()}`, startsAt: slotTime.toISOString() });
      }
      if (daysAdded > 10) break; // safety valve
    }
    return slots;
  }

  /** Idempotent on (callId + appointmentRequestId) per CLAUDE.md §27. */
  async scheduleFollowUp(input: {
    matterId: string;
    slotId: string;
    callId: string;
    appointmentRequestId: string;
    type?: string;
  }): Promise<{ appointmentId: string; scheduledAt: string; status: string; idempotent: boolean }> {
    const idempotencyKey = `${input.callId}:${input.appointmentRequestId}`;

    const existing = await prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return {
        appointmentId: existing.id,
        scheduledAt: existing.scheduledAt.toISOString(),
        status: existing.status,
        idempotent: true,
      };
    }

    const scheduledAt = parseSlot(input.slotId);

    const appointment = await prisma.appointment.create({
      data: {
        matterId: input.matterId,
        scheduledAt,
        type: input.type ?? "follow_up_call",
        status: "SCHEDULED",
        idempotencyKey,
      },
    });

    await prisma.matter.update({ where: { id: input.matterId }, data: { status: "SCHEDULED" } });

    return {
      appointmentId: appointment.id,
      scheduledAt: appointment.scheduledAt.toISOString(),
      status: appointment.status,
      idempotent: false,
    };
  }

  async reschedule(input: { appointmentId: string; slotId: string; appointmentRequestId: string }) {
    const idempotencyKey = `reschedule:${input.appointmentId}:${input.appointmentRequestId}`;
    const existing = await prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (existing) return { appointmentId: existing.id, scheduledAt: existing.scheduledAt.toISOString(), status: existing.status, idempotent: true };
    const appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId } });
    if (!appointment || !["SCHEDULED", "CONFIRMED"].includes(appointment.status)) throw new Error("active appointment not found");
    const updated = await prisma.appointment.update({ where: { id: appointment.id }, data: { scheduledAt: parseSlot(input.slotId), idempotencyKey } });
    return { appointmentId: updated.id, scheduledAt: updated.scheduledAt.toISOString(), status: updated.status, idempotent: false };
  }

  async cancel(input: { appointmentId: string; cancellationRequestId: string }) {
    const idempotencyKey = `cancel:${input.appointmentId}:${input.cancellationRequestId}`;
    const existing = await prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (existing) return { appointmentId: existing.id, status: existing.status, idempotent: true };
    const appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId } });
    if (!appointment || !["SCHEDULED", "CONFIRMED"].includes(appointment.status)) throw new Error("active appointment not found");
    const updated = await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED", idempotencyKey } });
    return { appointmentId: updated.id, status: updated.status, idempotent: false };
  }
}

function parseSlot(slotId: string): Date {
  const scheduledAt = new Date(slotId.replace(/^slot-/, ""));
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getMinutes() !== 0 || ![10, 14].includes(scheduledAt.getHours()) || [0, 6].includes(scheduledAt.getDay())) {
    throw new Error(`invalid or unavailable slotId: ${slotId}`);
  }
  return scheduledAt;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
