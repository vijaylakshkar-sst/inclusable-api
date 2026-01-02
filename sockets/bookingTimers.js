// Shared booking timer store (used across socket handlers)

const bookingTimers = new Map();
const bookingDriversMap = new Map();

module.exports = {
  bookingTimers,bookingDriversMap
};
