// Vite's ?raw import suffix — returns the file contents as a string.
declare module '*?raw' {
  const content: string
  export default content
}
