import { prisma, type Matter } from "@repo/db";
import type { IntakeFields, QualificationStatus } from "@repo/shared";

/**
 * Caller/Matter persistence (CLAUDE.md §7 `CaseService`). This is the only
 * place that writes Caller/Matter rows — tools call through here, never
 * touching Prisma directly (CLAUDE.md §33).
 */
export class CaseService {
  /**
   * Returns the caller *with* their most recent still-open matter. The matter has to come
   * back from this same lookup: `get_matter` needs a matterId, and a phone number is the
   * only identifier a caller actually says out loud — without this the agent could confirm
   * "yes, I have your record" and still be unable to reach the case attached to it.
   */
  async findCallerByPhone(phone: string) {
    const normalizedPhone = normalizePhone(phone);
    const callers = await prisma.caller.findMany({
      where: { phone: { not: null } },
      include: {
        matters: {
          where: { status: { notIn: ["CLOSED", "DISQUALIFIED"] } },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    return callers.find((caller) => normalizePhone(caller.phone ?? "") === normalizedPhone) ?? null;
  }

  async createCaller(input: { name: string; phone: string; email?: string | null }) {
    const phone = normalizePhone(input.phone);
    if (phone.length < 10) throw new Error("a complete phone number is required");
    return prisma.caller.upsert({
      where: { phone },
      update: { name: input.name, email: input.email ?? undefined },
      create: { name: input.name, phone, email: input.email ?? undefined },
    });
  }

  async createMatter(input: { callerId: string; matterType: string }) {
    return prisma.matter.create({
      data: { callerId: input.callerId, incidentType: input.matterType, status: "INTAKE" },
    });
  }

  async getMatter(matterId: string) {
    return prisma.matter.findUnique({ where: { id: matterId }, include: { caller: true } });
  }

  /**
   * Merges partial structured intake fields into the Matter row. Field names
  * The Prisma columns retain their original names for compatibility with the
  * existing database. Salon terminology is translated at this boundary only.
   */
  async updateIntake(matterId: string, fields: IntakeFields): Promise<Matter> {
    const data: Record<string, unknown> = {};
    const columnByField: Record<string, string> = {
      serviceRequested: "incidentType",
      preferredDate: "incidentDate",
      bookingNotes: "incidentDescription",
      stylistPreference: "otherPartyInformation",
    };
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      const key = columnByField[field];
      if (!key) continue;
      data[key] = key === "incidentDate" && typeof value === "string" ? new Date(value) : value;
    }
    return prisma.matter.update({ where: { id: matterId }, data });
  }

  async setQualificationStatus(matterId: string, status: QualificationStatus) {
    return prisma.matter.update({ where: { id: matterId }, data: { qualificationStatus: status } });
  }

  async appendNote(matterId: string, note: string) {
    const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { notes: true } });
    const stamped = `[${new Date().toISOString()}] ${note}`;
    const notes = matter?.notes ? `${matter.notes}\n${stamped}` : stamped;
    return prisma.matter.update({ where: { id: matterId }, data: { notes } });
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}
