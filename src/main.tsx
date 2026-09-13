import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceProvider } from "./hooks/useWorkspace";
import { App } from "./App";
import "./styles/app.css";
import "./styles/workspace.css";
const client = new QueryClient({
  defaultOptions: {
    mutations: { networkMode: "always" },
    queries: { networkMode: "always", staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error) {
    console.error("UniDesk rendering error", error);
  }
  render() {
    return this.state.error ? (
      <div className="startup-error">
        <h1>Something went wrong</h1>
        <p>Your saved data is still on this device.</p>
        <button onClick={() => window.location.reload()}>
          Reopen workspace
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <QueryClientProvider client={client}>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </QueryClientProvider>
  </ErrorBoundary>,
);
