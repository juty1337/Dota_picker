const externalNodeModules = process.env.DOTA_PICKER_NODE_MODULES;

export default {
  base: "./",
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: externalNodeModules
      ? {
          react: `${externalNodeModules}/react`,
          "react-dom/client": `${externalNodeModules}/react-dom/client`,
          "react/jsx-runtime": `${externalNodeModules}/react/jsx-runtime`
        }
      : {}
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
};
