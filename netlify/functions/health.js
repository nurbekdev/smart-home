export default async () => {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "smart-motion-light-serverless",
      time: new Date().toISOString()
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
};
