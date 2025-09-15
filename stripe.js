// stripe.js
const Stripe = require('stripe');
const stripe = new Stripe('sk_test_51LicFNFkV20vz5IvJAd9bcT6sMycEJeD8xdFG81Uzf3cyOJZYjacfP2sQ6ReUdaLYJLsq5VkDhFAtf2oNCktolvm00gXjMn7iA'); // from Stripe dashboard

module.exports = stripe;