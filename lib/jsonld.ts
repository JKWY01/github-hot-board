/** JSON-LD <script> 注入的安全序列化。
 *
 * `JSON.stringify` 不转义 `<`、`>`、`&`,而 dangerouslySetInnerHTML 的内容不经 React 转义 ——
 * 字段里出现字面 `</script>` 会直接闭合标签,其后的任意标记被浏览器当页面内容执行。
 * 仓库 description / README 首句是仓库作者可控的原文,这是真实攻击面(伪造 30 星上黑马榜即可入库),
 * 所以所有进 <script type="application/ld+json"> 的载荷都必须经这里出口。 */
export function jsonLdScript(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
