import mqtt from "mqtt";

function getUrl() {
  const url = (process.env.MQTT_URL || "").trim();
  if (!url) throw new Error("MQTT_URL is not configured");
  return url;
}

function createClientId() {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `netlify-telegram-${Date.now()}-${rnd}`;
}

export async function mqttPublish(topic, payload, options = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let settled = false;
    let failTimeout;
    const client = mqtt.connect(getUrl(), {
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS,
      clientId: createClientId(),
      protocolVersion: 4,
      connectTimeout: Number(process.env.MQTT_CONNECT_TIMEOUT_MS || 8000),
      reconnectPeriod: 0,
      clean: true,
      keepalive: 15
    });

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(failTimeout);
      client.end(true);
      fn(value);
    };

    failTimeout = setTimeout(() => {
      settle(reject, new Error("MQTT publish timeout"));
    }, Number(process.env.MQTT_PUBLISH_TIMEOUT_MS || 12000));

    client.on("connect", () => {
      client.publish(topic, JSON.stringify(payload), { qos: 1, ...options }, (err) => {
        if (err) {
          settle(reject, err);
          return;
        }
        settle(resolve, { latencyMs: Date.now() - start, topic });
      });
    });

    client.on("error", (err) => {
      settle(reject, err);
    });
  });
}
