type Line = { op: ' ' | '-' | '+'; text: string }

/** Line diff (LCS) in unified style with 3 lines of context. Small and dependency-free; templates are short. */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) return '(files too large to diff here)'

  // lcs(i, j) = length of the longest common subsequence of a[i..] and b[j..]
  const table = new Uint32Array((n + 1) * (m + 1))
  const lcs = (i: number, j: number) => table[i * (m + 1) + j] ?? 0
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] =
        a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1))
    }
  }
  const lines: Line[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push({ op: ' ', text: a[i] ?? '' })
      i++
      j++
    } else if (i < n && (j >= m || lcs(i + 1, j) >= lcs(i, j + 1))) {
      lines.push({ op: '-', text: a[i] ?? '' })
      i++
    } else {
      lines.push({ op: '+', text: b[j] ?? '' })
      j++
    }
  }

  const changed: number[] = []
  lines.forEach((line, index) => {
    if (line.op !== ' ') changed.push(index)
  })
  const out: string[] = []
  let start = 0
  while (start < changed.length) {
    let end = start
    while (end + 1 < changed.length && (changed[end + 1] ?? 0) - (changed[end] ?? 0) <= context * 2)
      end++
    const from = Math.max(0, (changed[start] ?? 0) - context)
    const to = Math.min(lines.length - 1, (changed[end] ?? 0) + context)
    out.push('@@')
    for (const line of lines.slice(from, to + 1)) out.push(`${line.op}${line.text}`)
    start = end + 1
  }
  return out.join('\n')
}
