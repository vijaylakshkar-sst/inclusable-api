const pool = require('../dbconfig');
const stripe = require('../stripe');

exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle payment success
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const paymentIntentId = paymentIntent.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Update transactions table
      await client.query(
        `UPDATE transactions SET status = 'succeeded' WHERE payment_intent_id = $1`,
        [paymentIntentId]
      );

      // 2. Update event_bookings table
      await client.query(`
        UPDATE event_bookings 
        SET payment_status = 'paid', status = 'confirmed' 
        WHERE id = (SELECT booking_id FROM transactions WHERE payment_intent_id = $1)
      `, [paymentIntentId]);

      await client.query('COMMIT');
      console.log('✅ Stripe payment succeeded and booking updated');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Webhook DB update failed:', err.message);
    } finally {
      client.release();
    }
  }

  res.json({ received: true });
};