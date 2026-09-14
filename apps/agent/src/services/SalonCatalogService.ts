import { prisma } from "@repo/db";

export class SalonCatalogService {
  async search(query?: string) {
    const services = await prisma.salonService.findMany({ where: { active: true }, orderBy: { category: "asc" } });
    const normalized = query?.trim().toLowerCase();
    const filtered = normalized
      ? services.filter((service) => `${service.name} ${service.category} ${service.description}`.toLowerCase().includes(normalized))
      : services;
    const stylists = await prisma.stylist.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    return {
      services: filtered.map(({ name, category, description, priceInr, durationMin }) => ({ name, category, description, priceInr, durationMin })),
      stylists: stylists.map(({ name, specialties }) => ({ name, specialties })),
    };
  }
}