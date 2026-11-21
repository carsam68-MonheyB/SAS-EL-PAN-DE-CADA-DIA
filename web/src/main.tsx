import "@mantine/core/styles.css";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

const tema = createTheme({ primaryColor: "orange", defaultRadius: "md", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" });
const consultas = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("raiz")!).render(
  <MantineProvider theme={tema}>
    <QueryClientProvider client={consultas}>
      <App />
    </QueryClientProvider>
  </MantineProvider>,
);
