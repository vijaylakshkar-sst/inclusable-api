const onlineDrivers = new Map();

module.exports = {
  addDriver(driverId, socketId) {
    onlineDrivers.set(driverId, socketId);
  },

  removeDriverBySocket(socketId) {
    for (let [key, value] of onlineDrivers.entries()) {
      if (value === socketId) onlineDrivers.delete(key);
    }
  },

  getSocket(driverId) {
    return onlineDrivers.get(driverId);
  },

  getAll() {
    return [...onlineDrivers.keys()];
  }
};
