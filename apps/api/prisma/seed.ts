import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
async function main() {
  const helipadData = [
    {
      name: 'HAL Helipad',
      city: 'Bengaluru',
      latitude: 12.9634,
      longitude: 77.6484,
    },
    {
      name: 'Electronic City Helipad',
      city: 'Bengaluru',
      latitude: 12.8452,
      longitude: 77.6602,
    },
    {
      name: 'Kempegowda Airport Helipad',
      city: 'Bengaluru',
      latitude: 13.1986,
      longitude: 77.7066,
    },
  ];

  const helipads: Awaited<ReturnType<typeof prisma.helipad.upsert>>[] = [];
  for (const h of helipadData) {
    const helipad = await prisma.helipad.upsert({
      where: { name: h.name },
      update: {},
      create: {
        name: h.name,
        city: h.city,
        latitude: h.latitude,
        longitude: h.longitude,
      },
    });
    helipads.push(helipad);

    await prisma.$executeRawUnsafe(
      `UPDATE helipads SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
      h.longitude,
      h.latitude,
      helipad.id,
    );
  }

  const operatorUser = await prisma.user.upsert({
    where: { email: 'operator@padhop.test' },
    update: {},
    create: {
      name: 'Test Charter Co',
      email: 'operator@padhop.test',
      role: 'operator',
    },
  });

  const operator = await prisma.operator.upsert({
    where: { userId: operatorUser.id },
    update: {},
    create: {
      userId: operatorUser.id,
      companyName: 'Test Charter Co',
      verified: true,
    },
  });

  const aircraft = await prisma.aircraft.upsert({
    where: { registration: 'VT-TEST1' },
    update: {},
    create: {
      operatorId: operator.id,
      model: 'Bell 407',
      capacity: 6,
      registration: 'VT-TEST1',
    },
  });

  console.log('Seeded:', {
    helipads: helipads.length,
    operator: operator.companyName,
    aircraft: aircraft.registration,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
