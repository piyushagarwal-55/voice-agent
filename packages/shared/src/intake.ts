import { z } from "zod";

/**
 * Structured intake fields (CLAUDE.md §10 Matter, §15 structured extraction).
 * The LLM only ever produces data shaped like this via a JSON-schema
 * constrained response; nothing free-form ever reaches Postgres.
 * All fields are optional/nullable because intake is collected incrementally
 * across many turns — a partial update should never fail validation.
 */
export const intakeFieldsSchema = z.object({
  serviceRequested: z.string().nullable().optional(),
  preferredDate: z.string().describe("Preferred appointment date, preferably ISO YYYY-MM-DD").nullable().optional(),
  preferredTime: z.string().nullable().optional(),
  stylistPreference: z.string().nullable().optional(),
  bookingNotes: z.string().nullable().optional(),
});

export type IntakeFields = z.infer<typeof intakeFieldsSchema>;

export const REQUIRED_INTAKE_FIELDS: (keyof IntakeFields)[] = [
  "serviceRequested",
  "preferredDate",
  "preferredTime",
];

export const callerContactSchema = z.object({
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});
export type CallerContact = z.infer<typeof callerContactSchema>;

/** Deterministic qualification rules (CLAUDE.md §7 QualificationAgent, §34). */
export const QualificationStatus = {
  PENDING: "PENDING",
  QUALIFIED: "QUALIFIED",
  INSUFFICIENT: "INSUFFICIENT",
  DISQUALIFIED: "DISQUALIFIED",
} as const;
export type QualificationStatus = (typeof QualificationStatus)[keyof typeof QualificationStatus];

export interface QualificationInput {
  serviceRequested: string | null | undefined;
  preferredDate: string | null | undefined;
  preferredTime: string | null | undefined;
}

export interface QualificationResult {
  status: QualificationStatus;
  reasons: string[];
}

/**
 * Pure, deterministic function — no LLM involved. Called by
 * QualificationAgent after IntakeAgent has extracted facts. Kept here so
 * both the agent runtime and unit tests import the exact same logic.
 */
export function evaluateQualification(input: QualificationInput): QualificationResult {
  const reasons: string[] = [];

  if (!input.serviceRequested) reasons.push("service_not_selected");
  if (!input.preferredDate) reasons.push("preferred_date_unknown");
  if (!input.preferredTime) reasons.push("preferred_time_unknown");

  if (reasons.length === 0) {
    return { status: QualificationStatus.QUALIFIED, reasons: [] };
  }

  return { status: QualificationStatus.INSUFFICIENT, reasons };
}
