import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "@fontsource-variable/inter";
import "./redesign.css";
import "./i18n.css";
import "./skins.css";
import "./catalog.css";
import "./content.css";
import "./home.css";
import "./servers.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
