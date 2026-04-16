import mqtt from "mqtt";

function getUrl() {
  const host = process.env.HIVEMQ_HOST;
  const port = process.env.HIVEMQ_PORT || "8884";
  return `wss://${host}:${port}/mqtt`;
}

function createClientId() {
  const p = process.env.HIVEMQ_CLIENT_PREFIX || "serverless-iot";
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${p}-${Date.now()}-${rnd}`;
}

export async function mqttPublish(topic, payload, options = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const client = mqtt.connect(getUrl(), {
      username: process.env.HIVEMQ_USERNAME,
      password: process.env.HIVEMQ_PASSWORD,
      clientId: createClientId(),
      protocolVersion: 4,
      connectTimeout: 5000,
      reconnectPeriod: 0,
      clean: true
    });

    const failTimeout = setTimeout(() => {
      client.end(true);
      reject(new Error("MQTT publish timeout"));
    }, 7000);

    client.on("connect", () => {
      client.publish(topic, JSON.stringify(payload), { qos: 1, ...options }, (err) => {
        clearTimeout(failTimeout);
        if (err) {
          client.end(true);
          reject(err);
          return;
        }
        client.end(false, () => {
          resolve({ latencyMs: Date.now() - start });
        });
      });
    });

    client.on("error", (err) => {
      clearTimeout(failTimeout);
      client.end(true);
      reject(err);
    });
  });
}
