import "@mantine/core/styles.css";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

const tema = createTheme({ primaryColor: "orange", defaultRadius: "md", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" });
// networkMode "always": sin internet las consultas y acciones no se pausan; la caja usa su propio respaldo (P43).
const consultas = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, networkMode: "always" }, mutations: { networkMode: "always" } } });

createRoot(document.getElementById("raiz")!).render(
  <MantineProvider theme={tema}>
    <QueryClientProvider client={consultas}>
      <App />
    </QueryClientProvider>
  </MantineProvider>,
);

// Guarda la aplicación para que la caja abra sin internet (P43). No en desarrollo local.
if (location.hostname !== "localhost" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
