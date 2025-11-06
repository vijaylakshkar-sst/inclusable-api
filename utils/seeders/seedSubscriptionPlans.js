// utils/seeders/seedSubscriptionPlans.js
const pool = require('../../dbconfig');

const seed = `
-- Step 1: Ensure the unique constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uniq_plan_type_role'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT uniq_plan_type_role UNIQUE (plan_type, audience_role);
  END IF;
END$$;

-- Step 2: Insert or update plans
INSERT INTO subscription_plans
  (audience_role, name, plan_type, price, currency, description, features, duration, trial_days, is_active)
VALUES
-- NDIS Member (matches your UI)
('NDIS Member','Starter Plan','free',0.00,'USD',
 'Browse and view all listed events with limited access.',
 ARRAY[
   'Browse and view all listed events',
   'Select up to 2 event categories',
   'Booking disabled (Upgrade prompt shown)',
   'Basic AI-powered search with limited queries'
 ], NULL, 0, TRUE),

('NDIS Member','Monthly Plan','monthly',8.99,'USD',
 'Access all event categories with unlimited booking and priority updates.',
 ARRAY[
   'Access all event categories',
   'Unlimited ticket booking',
   'Priority access to event updates',
   'Save, filter, and favorite events'
 ], INTERVAL '1 month', 7, TRUE),

('NDIS Member','Annual Plan','yearly',89.99,'USD',
 'Get full event access for a year with all premium features.',
 ARRAY[
   'Access all event categories',
   'Unlimited ticket booking',
   'Priority access to event updates',
   'Save, filter, and favorite events'
 ], INTERVAL '1 year', 7, TRUE),

-- Company (updated as per new design)
('Company','Starter Plan','starter',9.99,'USD',
 'Best for small companies starting out.',
 ARRAY[
   '2 Events Post / Month',
   'Free Tickets only',
   'Basic Analytics',
   'Standard Support'
 ], INTERVAL '1 month', 30, TRUE),

('Company','Growth Plan','growth',49.99,'USD',
 'For growing businesses managing more events.',
 ARRAY[
   '5 Events Post / Month',
   'Free and Paid Tickets',
   'Standard Analytics',
   'Priority Support'
 ], INTERVAL '1 month', 30, TRUE),

('Company','Professional Plan','professional',99.99,'USD',
 'For large businesses needing advanced tools.',
 ARRAY[
   'Unlimited Events Post / Month',
   'Free and Paid Tickets',
   'Advanced Analytics',
   'Dedicated Support'
 ], INTERVAL '1 month', 30, TRUE)
ON CONFLICT (plan_type, audience_role) DO UPDATE
SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  description = EXCLUDED.description,
  features = EXCLUDED.features,
  duration = EXCLUDED.duration,
  trial_days = EXCLUDED.trial_days,
  is_active = EXCLUDED.is_active,
  updated_at = CURRENT_TIMESTAMP;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(seed);
    console.log('✅ Subscription plans seeded successfully (Company + NDIS Member).');
  } catch (e) {
    console.error('❌ Seeding error:', e.message);
  } finally {
    client.release();
    process.exit();
  }
})();
