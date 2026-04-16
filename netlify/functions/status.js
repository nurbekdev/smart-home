import { getLogs, getState } from "./_lib/state.js";

export default async () => {
  const state = await getState();
  const logs = await getLogs();
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      state,
      logs: logs.slice(0, 20)
    })
  };
};
