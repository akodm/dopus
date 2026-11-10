// Lets tsconfig.templates.json typecheck the copy-in UI; Next.js provides this in real apps.
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
