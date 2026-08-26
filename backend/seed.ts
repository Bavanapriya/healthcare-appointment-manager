import bcrypt from 'bcryptjs';
import prisma from './db.js';

async function seed() {
  console.log('Seeding database...');
  
  const adminExists = await prisma.user.findFirst({
    where: { role: 'admin' }
  });

  if (!adminExists) {
    const salt = await bcrypt.genSalt(10);
    
    // Seed Admin
    const adminPass = await bcrypt.hash('admin123', salt);
    await prisma.user.create({
      data: {
        email: 'admin@clinic.com',
        passwordHash: adminPass,
        name: 'System Admin',
        role: 'admin'
      }
    });

    // Seed Doctor Alice
    const doctorPass = await bcrypt.hash('doctor123', salt);
    await prisma.user.create({
      data: {
        email: 'alice@clinic.com',
        passwordHash: doctorPass,
        name: 'Dr. Alice Smith',
        role: 'doctor',
        doctorProfile: {
          create: {
            specialisation: 'Cardiology',
            workingHoursStart: '09:00',
            workingHoursEnd: '17:00',
            slotDuration: 30
          }
        }
      }
    });

    // Seed Doctor Bob
    await prisma.user.create({
      data: {
        email: 'bob@clinic.com',
        passwordHash: doctorPass,
        name: 'Dr. Bob Johnson',
        role: 'doctor',
        doctorProfile: {
          create: {
            specialisation: 'Dermatology',
            workingHoursStart: '10:00',
            workingHoursEnd: '16:00',
            slotDuration: 30
          }
        }
      }
    });

    // Seed Doctor Charlie
    await prisma.user.create({
      data: {
        email: 'charlie@clinic.com',
        passwordHash: doctorPass,
        name: 'Dr. Charlie Brown',
        role: 'doctor',
        doctorProfile: {
          create: {
            specialisation: 'Pediatrics',
            workingHoursStart: '08:30',
            workingHoursEnd: '15:30',
            slotDuration: 30
          }
        }
      }
    });

    // Seed Patient
    const patientPass = await bcrypt.hash('patient123', salt);
    await prisma.user.create({
      data: {
        email: 'patient@clinic.com',
        passwordHash: patientPass,
        name: 'John Doe',
        role: 'patient'
      }
    });

    console.log('Database seeded successfully.');
  } else {
    console.log('Database already has data. Skipping seed.');
  }
}

seed()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
