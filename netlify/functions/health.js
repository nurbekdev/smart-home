export default async () => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: true,
      service: "smart-motion-light-serverless",
      time: new Date().toISOString()
    })
  };
};
