import mqtt from "mqtt";

function getUrl() {
  let host = (process.env.HIVEMQ_HOST || "").trim();
  host = host.replace(/^https?:\/\//i, "");
  host = host.split("/")[0] || "";
  if (host.includes(":")) host = host.split(":")[0];
  const port = process.env.HIVEMQ_PORT || "8884";
  if (!host) throw new Error("HIVEMQ_HOST is empty");
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
      connectTimeout: 15000,
      reconnectPeriod: 0,
      clean: true,
      keepalive: 30
    });

    const failTimeout = setTimeout(() => {
      client.end(true);
      reject(new Error("MQTT publish timeout"));
    }, 20000);

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
