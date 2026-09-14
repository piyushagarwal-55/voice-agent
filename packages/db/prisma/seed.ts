/**
 * Synthetic demo data only (CLAUDE.md §25/§26) — never real client PII.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const services = [
    { name: "Women's Haircut", category: "Hair", description: "Wash, haircut, and basic styling", priceInr: 800, durationMin: 60 },
    { name: "Men's Haircut", category: "Hair", description: "Haircut with wash and styling", priceInr: 450, durationMin: 45 },
    { name: "Beard Trim", category: "Grooming", description: "Beard shaping and finishing", priceInr: 250, durationMin: 30 },
    { name: "Haircut and Beard Combo", category: "Grooming", description: "Men's haircut plus beard trim", priceInr: 650, durationMin: 75 },
    { name: "Hair Spa", category: "Hair Care", description: "Nourishing hair treatment and head massage", priceInr: 1200, durationMin: 60 },
    { name: "Global Hair Color", category: "Color", description: "Single-process all-over hair color", priceInr: 2500, durationMin: 150 },
    { name: "Highlights", category: "Color", description: "Partial highlights with toner", priceInr: 3500, durationMin: 180 },
    { name: "Facial", category: "Skin Care", description: "Cleansing, exfoliation, mask, and moisturising", priceInr: 1000, durationMin: 60 },
    { name: "Manicure", category: "Nails", description: "Nail shaping, cuticle care, and polish", priceInr: 600, durationMin: 45 },
    { name: "Pedicure", category: "Nails", description: "Foot soak, nail care, scrub, and polish", priceInr: 800, durationMin: 60 },
    { name: "Bridal Makeup", category: "Makeup", description: "Full bridal makeup consultation and application", priceInr: 12000, durationMin: 240 },
  ];
  for (const service of services) {
    await prisma.salonService.upsert({ where: { name: service.name }, update: service, create: service });
  }

  const stylists = [
    { name: "Riya", specialties: ["Women's Haircut", "Highlights", "Hair Spa"] },
    { name: "Arjun", specialties: ["Men's Haircut", "Beard Trim", "Haircut and Beard Combo"] },
    { name: "Meera", specialties: ["Facial", "Manicure", "Pedicure", "Bridal Makeup"] },
  ];
  for (const stylist of stylists) {
    await prisma.stylist.upsert({ where: { name: stylist.name }, update: stylist, create: stylist });
  }

  const caller = await prisma.caller.upsert({
    where: { phone: "+1-555-0100" },
    update: {},
    create: {
      name: "Sarah Miller",
      phone: "+1-555-0100",
      email: "sarah.miller@example.com",
      preferredLanguage: "en",
    },
  });

  const existingMatter = await prisma.matter.findFirst({
    where: { callerId: caller.id, incidentType: "motor_vehicle_accident" },
  });

  const matter =
    existingMatter ??
    (await prisma.matter.create({
      data: {
        callerId: caller.id,
        status: "INTAKE",
        incidentType: "motor_vehicle_accident",
        incidentDate: new Date("2026-08-05T00:00:00.000Z"),
        incidentLocation: "Intersection of 5th Ave & Main St, Springfield",
        incidentDescription: "Rear-ended while stopped at a red light.",
        injuries: ["lower back pain", "whiplash"],
        treatmentReceived: "Evaluated at Springfield Urgent Care",
        emergencyServicesInvolved: true,
        policeReport: true,
        insuranceInformation: "Other driver insured with Acme Mutual",
        representedByAttorney: false,
        qualificationStatus: "PENDING",
      },
    }));

  const existingAppointment = await prisma.appointment.findFirst({
    where: { matterId: matter.id },
  });

  if (!existingAppointment) {
    await prisma.appointment.create({
      data: {
        matterId: matter.id,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days out
        type: "follow_up_call",
        status: "SCHEDULED",
        idempotencyKey: `seed-${matter.id}`,
      },
    });
  }

  console.log("Seeded demo caller/matter/appointment:", {
    callerId: caller.id,
    matterId: matter.id,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
