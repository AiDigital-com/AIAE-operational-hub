import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { AuthProvider } from "./shared/auth/AuthProvider";
import { runtimeConfig } from "./shared/config/runtime";

runtimeConfig.validate();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
