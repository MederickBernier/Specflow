// Stylesheets are bundled by esbuild into dist/webview.css.
declare module "*.css";

// Tests load fixtures as text through Vite.
declare module "*?raw" {
  const text: string;
  export default text;
}
