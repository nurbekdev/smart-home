export const TOPICS = {
  command: process.env.MQTT_COMMAND_TOPIC || "elshodlampa/device-1/cmd",
  status: process.env.MQTT_STATUS_TOPIC || "elshodlampa/device-1/status"
};

export const DEFAULTS = {
  deviceId: process.env.DEVICE_ID || "device-1"
};
