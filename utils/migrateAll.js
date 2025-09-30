const { exec } = require('child_process');
const path = require('path');

const migrationFiles = [
  'createUsersTable.js',
  'alterUsersTable.js',
  'createLocationAccessibilityTable.js',
  'createNdisInformationTable.js',
  'createUserOnboardingSkipsTable.js',
  'createEventsTable.js',
  'alterUsersTable.js',
  'createNDISDropdownTables.js',
  'createAccessibilityRequirementsTable.js',
  'alterUsersTableBusinessFields.js',
  'createCompanyEventsTable.js',
  'createEventBookingTable.js',
  'alterEventBookings_addStatus.js',
  'alterEventBookingNewField.js',
  'createTermsConditionsTable.js',
  'createPrivacyPolicyTable.js',
  'createTransactionsTable.js',
  'createCabTypesTable.js',
  'createCabBookingsTable.js',
  'createDriversTable.js',
  'createBookingRoutesTable.js',
  'createNotificationsTable.js',
  'createBusinessCategoryTable.js',
  'alterUserBusinessCateField.js'
];

const runMigration = (file) => {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(__dirname, file);
    
    // QUOTE the full path for Windows compatibility
    const command = `node "${fullPath}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error in ${file}:\n`, stderr);
        reject(error);
      } else {
        console.log(stdout);
        resolve();
      }
    });
  });
};

(async () => {
  console.log('🔄 Starting migrations...\n');
  for (const file of migrationFiles) {
    try {
      await runMigration(file);
    } catch (err) {
      console.error(`⚠️ Migration failed at ${file}. Stopping further execution.`);
      process.exit(1);
    }
  }
  console.log('\n✅ All migrations executed.');
})();
