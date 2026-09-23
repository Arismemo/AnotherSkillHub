export async function settleRequests(ids, request) {
  const results = await Promise.allSettled(ids.map((id) => request(id)));
  const succeeded = [];
  const failed = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') succeeded.push(ids[index]);
    else failed.push({ id: ids[index], error: result.reason });
  });
  return { succeeded, failed };
}
