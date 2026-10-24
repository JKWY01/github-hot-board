/** 仓库名形状校验的单一事实源。
 * 之前 7 处各自为政(长度上限 64/100/120 混用),迟早有人只改一处;
 * 这里取最宽松的一档(owner ≤100 / repo ≤120,覆盖 GitHub 真实上限),
 * 宁可放行后由页内 notFound 兜底,不可把真仓库错杀成 404。 */
export const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,120}$/

export function isRepoFullName(value: string): boolean {
  return REPO_FULL_NAME_RE.test(value)
}
