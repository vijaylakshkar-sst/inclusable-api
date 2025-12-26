// stripe.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_KEY); // from Stripe dashboard

module.exports = stripe;