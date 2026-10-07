// These selectors change report rows, but not the accompanying summary counts.
const ROW_SELECTORS = ['workflow_view', 'metric', 'work_source', 'call_issue_type', 'page', 'page_size', 'sort', 'order'];

export function sameReportScope(previous: readonly unknown[] | undefined, current: readonly unknown[], rowSelectors = ROW_SELECTORS): boolean {
  if (!previous || previous.length !== current.length) return false;
  // Everything before the query string includes endpoint, actor and profile IDs.
  if (current.slice(0, -1).some((value, index) => previous[index] !== value)) return false;
  // /leads and /leads/distribution/workflow use different report contracts.
  if (new URLSearchParams(String(previous[previous.length - 1])).has('workflow_view') !==
      new URLSearchParams(String(current[current.length - 1])).has('workflow_view')) return false;
  const scope = (value: unknown) => {
    const params = new URLSearchParams(String(value ?? ''));
    rowSelectors.forEach(key => params.delete(key));
    params.sort();
    return params.toString();
  };
  return scope(previous[previous.length - 1]) === scope(current[current.length - 1]);
}
