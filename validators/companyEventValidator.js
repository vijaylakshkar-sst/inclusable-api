const Joi = require('joi');

exports.eventCreateSchema = Joi.object({
  event_name: Joi.string().min(3).max(255).required(),
  event_types: Joi.string().allow(''), // comma-separated
  disability_types: Joi.string().allow(''),
  accessibility_types: Joi.string().allow(''),
  event_description: Joi.string().allow(''),
  start_date: Joi.date().allow(null),
  end_date: Joi.date().allow(null),
  start_time: Joi.string().allow(null),
  end_time: Joi.string().allow(null),
  price_type: Joi.string().valid('Free', 'Paid').allow(null),
  price: Joi.number().min(0).allow(null),
  total_available_seats: Joi.number().integer().min(0).allow(null),
  event_address: Joi.string().allow(''),
  how_to_reach_destination: Joi.string().allow(''),
  latitude: Joi.number().allow(null),
  longitude: Joi.number().allow(null),
  tickets: Joi.string().allow(null),
  accessibility_features: Joi.string().allow('')
});

exports.eventUpdateSchema = Joi.object({
  event_name: Joi.string().min(3).max(255).allow(null),
  event_types: Joi.string().allow(''), // comma-separated
  disability_types: Joi.string().allow(''),
  accessibility_types: Joi.string().allow(''),
  event_description: Joi.string().allow(''),
  start_date: Joi.date().allow(null),
  end_date: Joi.date().allow(null),
  start_time: Joi.string().allow(null),
  end_time: Joi.string().allow(null),
  price_type: Joi.string().valid('Free', 'Paid').allow(null),
  price: Joi.number().min(0).allow(null),
  total_available_seats: Joi.number().integer().min(0).allow(null),
  event_address: Joi.string().allow(''),
  how_to_reach_destination: Joi.string().allow(''),
  latitude: Joi.number().allow(null),
  longitude: Joi.number().allow(null),
  tickets: Joi.string().allow(null),
  accessibility_features: Joi.string().allow('')
});