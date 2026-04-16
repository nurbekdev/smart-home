import { getLogs, getState } from "./_lib/state.js";

export default async () => {
  const state = await getState();
  const logs = await getLogs();
  return new Response(
    JSON.stringify({
      state,
      logs: logs.slice(0, 20)
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
};
