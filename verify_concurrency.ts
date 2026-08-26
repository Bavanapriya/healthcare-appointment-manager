import prisma from './backend/db.js';

async function runConcurrencyTest() {
  console.log('=== MedVibe Concurrency Validation Test ===');

  try {
    // Find a seeded doctor
    const doctor = await prisma.user.findFirst({
      where: { role: 'doctor' }
    });
    
    if (!doctor) {
      console.error('No doctor users found in the database. Run seed script first.');
      process.exit(1);
    }

    console.log(`Testing slot booking concurrency for: ${doctor.name} (ID: ${doctor.id})`);

    const date = '2026-09-15';
    const startTime = '10:00';
    const expiresAt = BigInt(Date.now() + 5 * 60 * 1000);

    // Clean up any existing holds for this slot before testing
    await prisma.slotHold.deleteMany({
      where: {
        doctorId: doctor.id,
        appointmentDate: date,
        startTime: startTime
      }
    });

    console.log(`Triggering 2 simultaneous, overlapping slot-hold reservation attempts...`);

    const attempt1 = prisma.slotHold.create({
      data: {
        doctorId: doctor.id,
        appointmentDate: date,
        startTime: startTime,
        holdToken: 'hold_token_patient_A',
        expiresAt: expiresAt
      }
    });

    const attempt2 = prisma.slotHold.create({
      data: {
        doctorId: doctor.id,
        appointmentDate: date,
        startTime: startTime,
        holdToken: 'hold_token_patient_B',
        expiresAt: expiresAt
      }
    });

    let successCount = 0;
    let failureCount = 0;
    let failureCode = '';
    let failureError = '';

    const results = await Promise.allSettled([attempt1, attempt2]);
    
    results.forEach((res, index) => {
      if (res.status === 'fulfilled') {
        successCount++;
        console.log(`Attempt ${index + 1}: SUCCESSFUL (Hold created)`);
      } else {
        failureCount++;
        failureError = res.reason.message;
        if (res.reason.code) {
          failureCode = res.reason.code;
        }
        console.log(`Attempt ${index + 1}: FAILED (${res.reason.message})`);
      }
    });

    console.log('\n=== Evaluation Results ===');
    console.log(`Total Successes: ${successCount}`);
    console.log(`Total Failures: ${failureCount}`);

    if (successCount === 1 && failureCount === 1 && (failureCode === 'P2002' || failureError.includes('Unique constraint'))) {
      console.log('✅ TEST PASSED: Concurrency check succeeded. Only one patient could hold the slot simultaneously.');
    } else {
      console.log('❌ TEST FAILED: Slot double hold occurred or unexpected error state.');
    }

  } catch (err: any) {
    console.error('Test execution error:', err.message);
  } finally {
    process.exit(0);
  }
}

runConcurrencyTest().catch(console.error);
