const pool = require('../dbconfig');

(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE user_subscriptions
      ADD CONSTRAINT unique_user_plan UNIQUE (user_id, plan_id);
    `);
    console.log('✅ Added unique constraint on (user_id, plan_id)');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('⚠️ Unique constraint already exists, skipping.');
    } else {
      console.error('❌ Migration error:', err.message);
    }
  } finally {
    client.release();
    process.exit();
  }
})();